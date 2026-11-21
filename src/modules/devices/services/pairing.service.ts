import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PairingSession } from '@prisma/client';
import { env } from '../../../config/env.js';
import { assertSameCompany, isAdmin } from '../../../shared/auth/scope.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../shared/errors/app-error.js';
import type { AuthenticatedDevice, AuthenticatedUser } from '../../../types/express.js';
import { hashDeviceToken } from '../../../utils/device-token.js';
import { toPublicDevice } from '../entities/device.entity.js';
import { logger } from '../../../utils/logger.js';
import { pairingTransaction, pruneExpiredPairings } from '../repositories/pairing.repository.js';
import type { Approval, Discovery } from '../validators/pairing.validators.js';

const lifetimeMs = 10 * 60_000;
const maxAttempts = 5;
const localDemo = env.MOCK_MODE && env.NODE_ENV !== 'production';
const key = env.PAIRING_KEY
  ? Buffer.from(env.PAIRING_KEY, 'hex')
  : localDemo
    ? randomBytes(32)
    : undefined;

function unavailable() {
  return new AppError(
    'Pareamento indisponível. Verifique a configuração da instalação.',
    503,
    'PAIRING_UNAVAILABLE',
  );
}

function derived(session: PairingSession, purpose: 'code' | 'credential') {
  if (!key) throw unavailable();
  return createHmac('sha256', key)
    .update([purpose, session.id, session.secretHash].join(':'))
    .digest();
}

function oledCode(session: PairingSession) {
  return (derived(session, 'code').readUInt32BE() % 1_000_000).toString().padStart(6, '0');
}

function credential(session: PairingSession) {
  return 'esp-' + derived(session, 'credential').toString('base64url');
}

function verifyOwner(
  session: PairingSession | null,
  secretHash: string,
): asserts session is PairingSession {
  if (!session || !timingSafeEqual(Buffer.from(session.secretHash), Buffer.from(secretHash))) {
    throw new UnauthorizedError('Sessão ou segredo de pareamento inválido.');
  }
}

export function pairingSecretHash(header: string | undefined) {
  if (!header || !/^[a-f0-9]{64}$/i.test(header))
    throw new UnauthorizedError('Segredo de pareamento inválido.');
  return hashDeviceToken(header.toLowerCase());
}

function verifyPending(
  session: PairingSession | null,
  user: AuthenticatedUser,
): asserts session is PairingSession {
  if (!session) throw new NotFoundError('Pareamento');
  assertSameCompany(user, session.empresaId);
  if (session.expiresAt.getTime() <= Date.now())
    throw new AppError('O código de pareamento expirou.', 410, 'PAIRING_EXPIRED');
  if (session.state !== 'pending') throw new ConflictError('Este pareamento já foi encerrado.');
}

export const pairingService = {
  async discover(input: Discovery, secretHash: string) {
    const empresaId = env.PAIRING_COMPANY_ID ?? (localDemo ? 1 : undefined);
    if (!key || !empresaId) throw unavailable();
    const result = await pairingTransaction(async (store) => {
      if (!(await store.company(empresaId))) throw unavailable();
      const previous = await store.sessionByMac(input.mac);
      const device = await store.deviceByMac(input.mac);
      if (device && (await store.sector(device.setorId))?.empresaId !== empresaId) {
        throw new ConflictError('Equipamento indisponível para esta instalação.');
      }
      if (previous && previous.expiresAt.getTime() > Date.now() && previous.state !== 'closed') {
        if (previous.secretHash !== secretHash || previous.empresaId !== empresaId)
          throw new ConflictError('Já existe um pareamento para este equipamento.');
        if (previous.state === 'rejected')
          throw new ConflictError('Pareamento rejeitado. Aguarde a expiração.');
        return { sessionId: previous.id, code: oledCode(previous), expiresAt: previous.expiresAt };
      }
      if (device && !device.revokedAt)
        throw new ConflictError(
          'Equipamento já cadastrado. A recuperação exige revogação pelo painel.',
        );
      const session: PairingSession = {
        ...input,
        empresaId,
        id: randomUUID(),
        secretHash,
        attempts: 0,
        state: 'pending',
        expiresAt: new Date(Date.now() + lifetimeMs),
      };
      await store.replaceSession(session);
      return { sessionId: session.id, code: oledCode(session), expiresAt: session.expiresAt };
    });
    void pruneExpiredPairings(empresaId).catch(() =>
      logger.warn('Falha na limpeza de pareamentos expirados.'),
    );
    return result;
  },

  status(id: string, secret: string) {
    return pairingTransaction(async (store) => {
      const session = await store.session(id);
      verifyOwner(session, secret);
      const status =
        session.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : session.state === 'closed'
            ? 'approved'
            : session.state;
      return { status };
    });
  },

  pending(user: AuthenticatedUser) {
    return pairingTransaction(async (store) => {
      const rows = await store.pending(isAdmin(user) ? undefined : (user.empresaId ?? -1));
      return Promise.all(
        rows.map(async ({ id, mac, model, firmwareVersion, sensorId, expiresAt, empresaId }) => {
          const device = await store.deviceByMac(mac);
          const sensor = device ? await store.sensor(device.id, sensorId) : null;
          return {
            id,
            mac,
            model,
            firmwareVersion,
            sensorId,
            expiresAt,
            empresaId,
            setorId: device?.setorId,
            ativoId: sensor?.ativoId,
          };
        }),
      );
    });
  },

  async approve(id: string, input: Approval, user: AuthenticatedUser) {
    const result = await pairingTransaction(async (store) => {
      const session = await store.session(id);
      verifyPending(session, user);
      if (!timingSafeEqual(Buffer.from(oledCode(session)), Buffer.from(input.code))) {
        const attempts = session.attempts + 1;
        await store.updateSession(id, {
          attempts,
          state: attempts >= maxAttempts ? 'rejected' : 'pending',
        });
        // A transação deve confirmar as tentativas antes de devolver o erro HTTP.
        return attempts >= maxAttempts ? ('locked' as const) : ('wrong' as const);
      }
      const sector = await store.sector(input.setorId);
      if (!sector || sector.empresaId !== session.empresaId)
        throw new ForbiddenError('Setor fora da empresa do pareamento.');
      const asset = await store.asset(input.ativoId);
      if (!asset || asset.setorId !== input.setorId)
        throw new ValidationError('Selecione um ativo do setor escolhido.');
      const previous = await store.deviceByMac(session.mac);
      const tokenHash = hashDeviceToken(credential(session));
      const info = { firmwareVersion: session.firmwareVersion, model: session.model, tokenHash };
      let device;
      if (previous) {
        const sensor = await store.sensor(previous.id, session.sensorId);
        if (
          !previous.revokedAt ||
          previous.setorId !== input.setorId ||
          sensor?.ativoId !== input.ativoId
        ) {
          throw new ConflictError(
            'Para parear novamente, use o setor e o ativo do dispositivo revogado.',
          );
        }
        device = await store.updateDevice(previous.id, {
          ...info,
          descricao: input.descricao ?? previous.descricao,
          revokedAt: null,
          ultimoContato: null,
        });
      } else {
        const espId = 'esp-' + session.mac.replaceAll(':', '').toLowerCase();
        if (await store.deviceByEspId(espId))
          throw new ConflictError('Identificador já usado por outro cadastro.');
        device = await store.addDevice({
          ...info,
          mac: session.mac,
          espId,
          setorId: input.setorId,
          descricao: input.descricao || null,
        });
        await store.addSensor(device.id, session.sensorId, input.ativoId);
      }
      await store.updateSession(id, {
        state: 'approved',
        expiresAt: new Date(Date.now() + lifetimeMs),
      });
      return toPublicDevice(device);
    });
    if (result === 'locked')
      throw new AppError(
        'Limite de tentativas atingido. Pareamento rejeitado.',
        429,
        'PAIRING_LOCKED',
      );
    if (result === 'wrong') throw new ValidationError('Código diferente do exibido no OLED.');
    return result;
  },

  reject(id: string, user: AuthenticatedUser) {
    return pairingTransaction(async (store) => {
      const session = await store.session(id);
      verifyPending(session, user);
      await store.updateSession(id, { state: 'rejected' });
    });
  },

  pickup(id: string, secret: string) {
    return pairingTransaction(async (store) => {
      const session = await store.session(id);
      verifyOwner(session, secret);
      if (session.expiresAt.getTime() <= Date.now() || session.state === 'closed') {
        throw new AppError('Retirada encerrada ou expirada.', 410, 'PAIRING_EXPIRED');
      }
      if (session.state !== 'approved') throw new ConflictError('A credencial requer aprovação.');
      const device = await store.deviceByMac(session.mac);
      const token = credential(session);
      if (!device || device.revokedAt || device.tokenHash !== hashDeviceToken(token))
        throw new ConflictError('Credencial revogada.');
      return { token, espId: device.espId };
    });
  },

  acknowledge(id: string, actor: AuthenticatedDevice) {
    return pairingTransaction(async (store) => {
      const session = await store.session(id);
      const device = await store.deviceById(actor.id);
      if (!session || !device || device.revokedAt || device.mac !== session.mac)
        throw new ForbiddenError();
      if (session.state === 'closed') return;
      if (session.state !== 'approved' || hashDeviceToken(credential(session)) !== device.tokenHash)
        throw new ConflictError('Pareamento não aprovado.');
      await store.updateSession(id, { state: 'closed' });
    });
  },

  revoke(id: number, user: AuthenticatedUser) {
    return pairingTransaction(async (store) => {
      const device = await store.deviceById(id);
      if (!device) throw new NotFoundError('Dispositivo');
      const sector = await store.sector(device.setorId);
      if (!sector) throw new NotFoundError('Setor');
      assertSameCompany(user, sector.empresaId);
      if (device.revokedAt) return;
      await store.updateDevice(id, { revokedAt: new Date() });
      const session = device.mac && (await store.sessionByMac(device.mac));
      if (session) await store.updateSession(session.id, { state: 'closed' });
    });
  },
};
