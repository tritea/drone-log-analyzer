import * as mapAPI from '@/wailsjs/go/wails/MapAPI';
import type { MapClient } from '../client';

export const wailsMapClient: MapClient = {
  available: () => mapAPI.Available(),
  providers: () => mapAPI.Providers(),
  cacheStats: () => mapAPI.CacheStats(),
  clearCache: () => mapAPI.ClearCache(),
  clearCacheProvider: (id) => mapAPI.ClearCacheProvider({ id }),
  tileLayerUrl: (providerId) => `/map/provider/${providerId}/{z}/{x}/{y}`,
};
