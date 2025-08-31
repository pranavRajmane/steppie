// static/js/modules/ApiHandler.js

/**
 * Handles all API calls to the Python Flask backend.
 */
export const ApiHandler = {
    async processStepFile(file) {
        const formData = new FormData();
        formData.append('stepFile', file);

        const response = await fetch('/process-step', {
            method: 'POST',
            body: formData,
        });
        return response.json();
    },

    async createBox(params) {
        const response = await fetch('/api/create/box', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        return response.json();
    },
    
    // Add other API calls here in the future (e.g., storeStl, checkProject, etc.)
};