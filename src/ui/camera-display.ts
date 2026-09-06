import type { CameraModel, DeepReadonly } from '../model/scene-model';
import { translate, type AppLocale } from './i18n';

/** Shared projection labels prevent the tree and viewport toolbar from disagreeing. */
export function cameraDisplay(camera: DeepReadonly<CameraModel>, locale: AppLocale): { label: string; scale: string } {
  if (camera.projection === 'orthographic') {
    return {
      label: locale === 'ja' ? '正投影' : 'Orthographic',
      scale: `${Number((camera.orthographicHeight ?? 10).toPrecision(5))} m`,
    };
  }
  return { label: translate(locale, 'scene.perspective'), scale: `${camera.fov.toFixed(0)}° FOV` };
}
