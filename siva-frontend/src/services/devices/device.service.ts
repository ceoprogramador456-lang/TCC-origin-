import { httpClient } from '../api/http-client';
import type { PaginatedResult, QueryParams } from '../../types/api';
import type {
  ApproveDevicePayload,
  PendingDevice,
  Device,
  UpdateDevicePayload,
} from '../../types/device';

export interface ListDevicesParams {
  page?: number;
  pageSize?: number;
  setorId?: number | null;
  empresaId?: number | null;
}

export const deviceService = {
  list(token: string, params: ListDevicesParams = {}): Promise<PaginatedResult<Device>> {
    const query: QueryParams = {
      page: params.page,
      pageSize: params.pageSize,
      setorId: params.setorId ?? undefined,
      empresaId: params.empresaId ?? undefined,
    };
    return httpClient.getPaginated<Device>('/devices', { token, query });
  },

  getById(token: string, id: number): Promise<Device> {
    return httpClient.get<Device>(`/devices/${id}`, { token });
  },

  pending(token: string): Promise<PendingDevice[]> {
    return httpClient.get<PendingDevice[]>('/devices/pending', { token });
  },

  approve(token: string, id: string, payload: ApproveDevicePayload): Promise<void> {
    return httpClient.post(`/devices/pairing/${encodeURIComponent(id)}/approve`, payload, {
      token,
    });
  },

  reject(token: string, id: string): Promise<void> {
    return httpClient.post(`/devices/pairing/${encodeURIComponent(id)}/reject`, undefined, {
      token,
    });
  },

  revoke(token: string, id: number): Promise<void> {
    return httpClient.post(`/devices/${id}/revoke`, undefined, { token });
  },

  update(token: string, id: number, payload: UpdateDevicePayload): Promise<Device> {
    return httpClient.patch<Device>(`/devices/${id}`, payload, { token });
  },

  remove(token: string, id: number): Promise<void> {
    return httpClient.delete(`/devices/${id}`, { token });
  },
};
