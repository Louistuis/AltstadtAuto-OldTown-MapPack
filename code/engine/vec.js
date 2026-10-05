// A tiny vector helper for the Old Town modules.
import * as THREE from 'three';

/** A new THREE.Vector3 (all components default to 0). */
export function V(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}
