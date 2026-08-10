import { useMapStateStore } from '@/modules/shared/map-state'
import { useMap3dStore } from '@/modules/map-3d'
import { useEarthStore } from '@/modules/earth'
import type { CustomModelSpec } from '@/modules/map-3d/renderer/drone-layer'

export type ModelPosePatch = Partial<Pick<CustomModelSpec, 'lon' | 'lat' | 'alt' | 'yaw' | 'pitch' | 'roll' | 'scale'>>

export interface ModelRendererApi {
  syncCustomModels(): void
  updateCustomModelPose(name: string, patch: ModelPosePatch): void
  syncGroupPose(groupName: string): void
  setGizmoActive(on: boolean, name?: string): void
  getMapCenter(): { lng: number; lat: number } | null
}

function activeStore(): ModelRendererApi {
  if (useMapStateStore().map.renderer === 'earth') return useEarthStore() as unknown as ModelRendererApi
  return useMap3dStore() as unknown as ModelRendererApi
}

export function useModelRenderer(): ModelRendererApi {
  return {
    syncCustomModels: (): void => activeStore().syncCustomModels(),
    updateCustomModelPose: (name: string, patch: ModelPosePatch): void => activeStore().updateCustomModelPose(name, patch),
    syncGroupPose: (groupName: string): void => activeStore().syncGroupPose(groupName),
    setGizmoActive: (on: boolean, name?: string): void => activeStore().setGizmoActive(on, name),
    getMapCenter: (): { lng: number; lat: number } | null => activeStore().getMapCenter(),
  }
}
