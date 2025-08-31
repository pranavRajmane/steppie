// static/js/main.js

import { StepViewer } from './StepViewer.js';

// Initialize the application once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => {

    
    const app = new StepViewer();
    
    // For debugging: expose the main app instance to the browser console.
    window.app = app;
    console.log("Access the main application instance via the 'app' variable in the console.");
});