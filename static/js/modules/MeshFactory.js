// static/js/modules/MeshFactory.js
import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';

/**
 * A factory for creating Three.js mesh objects from server data.
 */
export const MeshFactory = {
    createFaceMesh(faceData, parentMeshData) {
        if (!faceData.vertices || faceData.vertices.length === 0) return null;

        const geometry = new THREE.BufferGeometry();
        
        // Flatten vertex array and create the position attribute
        const vertices = new Float32Array(faceData.vertices.flat());
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

        // --- NEW: Use the index data from the server ---
        if (faceData.indices && faceData.indices.length > 0) {
            geometry.setIndex(faceData.indices);
        }
        // ---------------------------------------------

        // Have Three.js calculate the normals for perfect shading
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.1,
            roughness: 0.8,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `face-${faceData.id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        mesh.userData = {
            faceId: faceData.id,
            faceInfo: faceData,
            isSelectable: true
        };

        return mesh;
    },

    createMeshFromData(meshData, index) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
        
        if (meshData.normals && meshData.normals.length > 0) {
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
        } else {
            geometry.computeVertexNormals();
        }
        
        if (meshData.indices && meshData.indices.length > 0) {
            geometry.setIndex(meshData.indices);
        }

        const material = new THREE.MeshStandardMaterial({
            color: 0x808080,
            metalness: 0.3,
            roughness: 0.4
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `mesh-${index}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isSelectable = true;
        
        return mesh;
    }
};