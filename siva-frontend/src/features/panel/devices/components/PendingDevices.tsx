import { useCallback, useState } from 'react';

import { AlertMessage } from '../../../../components/ui/AlertMessage';
import { Button } from '../../../../components/ui/Button';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { LoadingBlock } from '../../../../components/ui/LoadingBlock';
import { useAsyncData } from '../../../../hooks/use-async-data';
import { deviceService } from '../../../../services/devices/device.service';
import type { PendingDevice } from '../../../../types/device';
import type { Sector } from '../../../../types/sector';
import { formatDateTime } from '../../../../utils/format';
import { PairingDialog } from './PairingDialog';

interface Props {
  token: string;
  empresaId: number | null;
  sectors: Sector[];
  refresh: number;
  onApproved: () => void;
}

export function PendingDevices({ token, empresaId, sectors, refresh, onApproved }: Props) {
  const { data, isLoading, error, reload } = useAsyncData(
    () => deviceService.pending(token),
    refresh,
    10_000,
  );
  const [selected, setSelected] = useState<PendingDevice | null>(null);
  const [rejecting, setRejecting] = useState<PendingDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const close = useCallback(() => setSelected(null), []);
  const rows = (data ?? []).filter((device) => empresaId === null || device.empresaId === empresaId);

  async function reject() {
    if (!rejecting || busy) return;
    setBusy(true);
    try {
      await deviceService.reject(token, rejecting.id);
      setMessage(`Solicitação de ${rejecting.mac} rejeitada.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Falha ao rejeitar a solicitação.');
    } finally {
      setRejecting(null);
      setBusy(false);
      reload();
    }
  }

  return (
    <section
      aria-label="Pareamento de dispositivos"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-semibold text-slate-900">Aguardando aprovação</h2>
      {error && <AlertMessage tone="danger">{error}</AlertMessage>}
      {actionError && <AlertMessage tone="danger">{actionError}</AlertMessage>}
      {message && <AlertMessage tone="success">{message}</AlertMessage>}
      {isLoading && !data && <LoadingBlock label="Buscando dispositivos…" />}
      {!isLoading && !error && rows.length === 0 && (
        <p className="text-sm text-slate-600">
          Nenhuma solicitação pendente. Ao conectar o ESP32 à rede, confira o código no display.
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((device) => (
          <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-semibold text-slate-900">
                {device.model} <span className="font-mono text-sm">{device.mac}</span>
              </p>
              <p className="text-xs text-slate-600">
                Firmware {device.firmwareVersion} · Código válido até{' '}
                {formatDateTime(device.expiresAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setActionError('');
                  setMessage('');
                  setRejecting(device);
                }}
              >
                Rejeitar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setActionError('');
                  setMessage('');
                  setSelected(device);
                }}
              >
                Conferir código
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {selected && (
        <PairingDialog
          key={selected.id}
          request={selected}
          token={token}
          sectors={sectors}
          onClose={close}
          onApproved={() => {
            setMessage(`Dispositivo ${selected.mac} aprovado.`);
            setSelected(null);
            reload();
            onApproved();
          }}
        />
      )}
      <ConfirmDialog
        open={rejecting !== null}
        title="Rejeitar pareamento"
        description={`Encerrar a solicitação de ${rejecting?.mac ?? ''}?`}
        confirmLabel="Rejeitar"
        isLoading={busy}
        onConfirm={() => void reject()}
        onCancel={() => {
          if (!busy) setRejecting(null);
        }}
      />
    </section>
  );
}
