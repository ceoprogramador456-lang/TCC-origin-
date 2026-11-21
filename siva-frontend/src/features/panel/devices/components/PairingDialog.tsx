import { useCallback, useEffect, useState } from 'react';

import { AlertMessage } from '../../../../components/ui/AlertMessage';
import { Button } from '../../../../components/ui/Button';
import { InputField, SelectField } from '../../../../components/ui/FormField';
import { Modal } from '../../../../components/ui/Modal';
import { useAsyncData } from '../../../../hooks/use-async-data';
import { allPages } from '../../../../services/api/all-pages';
import { assetService } from '../../../../services/assets/asset.service';
import { deviceService } from '../../../../services/devices/device.service';
import type { PendingDevice } from '../../../../types/device';
import type { Sector } from '../../../../types/sector';

interface PairingDialogProps {
  request: PendingDevice;
  token: string;
  sectors: Sector[];
  onClose: () => void;
  onApproved: () => void;
}

export function PairingDialog({
  request,
  token,
  sectors,
  onClose,
  onApproved,
}: PairingDialogProps) {
  const [code, setCode] = useState('');
  const [setorId, setSetorId] = useState(String(request.setorId ?? ''));
  const [ativoId, setAtivoId] = useState(String(request.ativoId ?? ''));
  const [descricao, setDescricao] = useState('');
  const [expired, setExpired] = useState(() => Date.parse(request.expiresAt) <= Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const close = useCallback(() => {
    if (!saving) onClose();
  }, [saving, onClose]);

  useEffect(() => {
    const delay = Math.max(0, Date.parse(request.expiresAt) - Date.now());
    const timer = window.setTimeout(() => setExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [request.expiresAt]);

  const {
    data: assets,
    error: assetsError,
    isLoading,
    reload,
  } = useAsyncData(
    () =>
      setorId
        ? allPages((page) =>
            assetService.list(token, {
              setorId: Number(setorId),
              page,
              pageSize: 100,
            }),
          )
        : Promise.resolve([]),
    setorId,
  );
  const availableSectors = sectors.filter((sector) => sector.empresaId === request.empresaId);
  const availableAssets = (assets ?? []).filter((asset) => asset.setorId === Number(setorId));

  async function approve() {
    if (saving || expired) return;
    setSaving(true);
    setError('');
    try {
      await deviceService.approve(token, request.id, {
        code,
        setorId: Number(setorId),
        ativoId: Number(ativoId),
        ...(descricao.trim() && { descricao: descricao.trim() }),
      });
      onApproved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao aprovar o dispositivo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title="Aprovar dispositivo"
      description={`${request.model} · ${request.mac}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="pairing-form"
            disabled={
              saving ||
              expired ||
              isLoading ||
              Boolean(assetsError) ||
              !/^[0-9]{6}$/.test(code) ||
              !availableAssets.some((asset) => asset.id === Number(ativoId))
            }
          >
            {saving ? 'Aprovando…' : 'Aprovar'}
          </Button>
        </>
      }
    >
      <form
        id="pairing-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void approve();
        }}
      >
        {expired && (
          <AlertMessage tone="warning">
            Código expirado. Use a próxima solicitação do ESP32.
          </AlertMessage>
        )}
        {error && <AlertMessage tone="danger">{error}</AlertMessage>}
        <InputField
          name="code"
          label="Código exibido no OLED"
          hint="Digite os seis algarismos que aparecem no equipamento."
          value={code}
          onChange={(value) => setCode(value.replace(/[^0-9]/g, '').slice(0, 6))}
          required
          disabled={saving || expired}
          autoComplete="off"
        />
        <SelectField
          name="setorId"
          label="Setor"
          value={setorId}
          required
          options={availableSectors.map((sector) => ({
            value: String(sector.id),
            label: sector.nome,
          }))}
          placeholder="Selecione o setor"
          disabled={saving || Boolean(request.setorId)}
          hint={
            !availableSectors.length ? 'Cadastre um setor nesta empresa para continuar.' : undefined
          }
          onChange={(value) => {
            setSetorId(value);
            setAtivoId('');
          }}
        />
        <SelectField
          name="ativoId"
          label="Ativo monitorado"
          value={ativoId}
          required
          options={availableAssets.map((asset) => ({ value: String(asset.id), label: asset.nome }))}
          placeholder="Selecione o ativo"
          disabled={!setorId || saving || isLoading || Boolean(request.ativoId)}
          hint={
            setorId && !isLoading && !assetsError && !availableAssets.length
              ? 'Cadastre um ativo no setor para associar as leituras deste sensor.'
              : `Sensor ${request.sensorId}`
          }
          onChange={setAtivoId}
        />
        {assetsError && (
          <AlertMessage tone="danger">
            {assetsError}{' '}
            <button type="button" onClick={reload} className="underline">
              Tentar novamente
            </button>
          </AlertMessage>
        )}
        <InputField
          name="descricao"
          label="Nome (opcional)"
          value={descricao}
          disabled={saving}
          onChange={(value) => setDescricao(value.slice(0, 100))}
        />
      </form>
    </Modal>
  );
}
