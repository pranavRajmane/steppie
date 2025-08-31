// static/js/modules/FaceSelector.js
import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';

/**
 * Manages face selection via raycasting.
 */
export class FaceSelector {
    constructor(camera, scene, canvas) {
        this.camera = camera;
        this.scene = scene;
        this.canvas = canvas;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.selectedFaces = new Set();
        this.hoveredFace = null;
        
        this.colors = {
            default: new THREE.Color(0xcccccc),
            hover: new THREE.Color(0xffaa00),
            selected: new THREE.Color(0x4CAF50)
        };
        
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('click', this.onClick.bind(this));
    }

    updateMouse(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    
    onMouseMove(event) {
        this.updateMouse(event);
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Only check objects that are flagged as selectable
        const intersects = this.raycaster.intersectObjects(
            this.scene.children.filter(c => c.userData.isSelectable)
        );

        if (this.hoveredFace && !this.selectedFaces.has(this.hoveredFace)) {
            this.hoveredFace.material.color.copy(this.colors.default);
        }
        this.hoveredFace = null;
        
        if (intersects.length > 0) {
            const intersectedObj = intersects[0].object;
            this.hoveredFace = intersectedObj;
            if (!this.selectedFaces.has(intersectedObj)) {
                intersectedObj.material.color.copy(this.colors.hover);
            }
            this.canvas.style.cursor = 'pointer';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    onClick(event) {
        this.updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(
             this.scene.children.filter(c => c.userData.isSelectable)
        );

        if (intersects.length > 0) {
            const clickedFace = intersects[0].object;
            if (this.selectedFaces.has(clickedFace)) {
                this.selectedFaces.delete(clickedFace);
                clickedFace.material.color.copy(this.colors.hover); // Revert to hover color
            } else {
                this.selectedFaces.add(clickedFace);
                clickedFace.material.color.copy(this.colors.selected);
            }
            console.log(`Selected faces: ${this.selectedFaces.size}`);
        }
    }
}