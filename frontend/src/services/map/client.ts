export interface MapClient {
  available(): Promise<boolean>;
  providers(): Promise<any>;
  cacheStats(): Promise<any>;
  clearCache(): Promise<void>;
  clearCacheProvider(id: string): Promise<void>;
  tileLayerUrl(providerId: string): string;
}
