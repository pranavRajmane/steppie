// static/js/modules/CameraControls.js
import * as THREE from 'https://cdn.skypack.dev/three@0.132.2';

/**
 * Manages user input for camera manipulation (rotate, pan, zoom).
 */
export class CameraControls {
    constructor(camera, canvas) {
        this.camera = camera;
        this.canvas = canvas;
        this.isRotating = false;
        this.isPanning = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.target = new THREE.Vector3(0, 0, 0); // Point the camera looks at

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this));
    }

    onMouseDown(event) {
        if (event.button === 0) this.isRotating = true; // Left mouse button
        if (event.button === 1) this.isPanning = true;  // Middle mouse button
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
    }

    onMouseMove(event) {
        if (!this.isRotating && !this.isPanning) return;
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;

        if (this.isRotating) this.rotateCamera(deltaX, deltaY);
        if (this.isPanning) this.panCamera(deltaX, deltaY);

        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
    }

    onMouseUp() {
        this.isRotating = false;
        this.isPanning = false;
    }

    onWheel(event) {
        event.preventDefault();
        this.zoomCamera(event.deltaY);
    }

    rotateCamera(deltaX, deltaY) {
        const spherical = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.target));
        spherical.theta -= deltaX * 0.005;
        spherical.phi -= deltaY * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
        this.camera.position.setFromSpherical(spherical).add(this.target);
        this.camera.lookAt(this.target);
    }
    
    panCamera(deltaX, deltaY) {
        const distance = this.camera.position.distanceTo(this.target);
        const panSpeed = distance * 0.001;

        const right = new THREE.Vector3().crossVectors(this.camera.up, this.camera.position.clone().sub(this.target).normalize()).multiplyScalar(-deltaX * panSpeed);
        const up = new THREE.Vector3().copy(this.camera.up).multiplyScalar(deltaY * panSpeed);
        
        this.camera.position.add(right).add(up);
        this.target.add(right).add(up);
    }

    zoomCamera(delta) {
        const zoomSpeed = 0.1;
        const direction = this.target.clone().sub(this.camera.position).normalize();
        const distance = this.camera.position.distanceTo(this.target);
        
        let newDist = distance + delta * zoomSpeed;
        if (newDist < 1) newDist = 1; // Prevent zooming too close

        this.camera.position.copy(this.target).sub(direction.multiplyScalar(newDist));
    }

    fitToScreen(objects) {
        if (objects.length === 0) return;
    
        const box = new THREE.Box3();
        objects.forEach(obj => box.expandByObject(obj));
    
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
    
        // This is the correct math
        const fov = this.camera.fov * (Math.PI / 180);
        const distance = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
    
        const direction = new THREE.Vector3(0, 0.5, 1).normalize(); // Look from a slight angle
        this.camera.position.copy(center).add(direction.multiplyScalar(distance * 1.5));
    
        this.target.copy(center);
        this.camera.lookAt(this.target);
    }
}