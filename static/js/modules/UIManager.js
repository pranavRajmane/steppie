// static/js/modules/UIManager.js

/**
 * Manages all DOM interactions, including pages, loading indicators, and messages.
 */
export class UIManager {
    constructor() {
        this.elements = this.cacheElements();
        this.createTypingOverlay();
    }

    cacheElements() {
        return {
            uploadPage: document.getElementById('uploadPage'),
            viewportPage: document.getElementById('viewportPage'),
            uploadArea: document.getElementById('uploadArea'),
            fileInput: document.getElementById('fileInput'),
            loading: document.getElementById('loading'),
            progressFill: document.getElementById('progressFill'),
            loadingStatus: document.getElementById('loadingStatus'),
            messageArea: document.getElementById('messageArea'),
            canvas: document.getElementById('canvas'),
            createBoxBtn: document.getElementById('createBoxBtn'),
            emptyCanvasBtn: document.getElementById('emptyCanvasBtn'), // Assuming this ID exists
        };
    }

    createTypingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'typingOverlay';
        overlay.style.cssText = `position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: #4CAF50; font-size: 1.5em; font-family: 'Courier New', monospace; padding: 15px 30px; border-radius: 10px; z-index: 10000; display: none; border: 2px solid #4CAF50; white-space: nowrap;`;
        
        const textElement = document.createElement('span');
        const cursor = document.createElement('span');
        cursor.textContent = '|';
        cursor.style.cssText = `animation: blink 1s infinite;`;
        
        overlay.appendChild(textElement);
        overlay.appendChild(cursor);
        document.body.appendChild(overlay);

        if (!document.getElementById('typing-animation-style')) {
            const style = document.createElement('style');
            style.id = 'typing-animation-style';
            style.textContent = `@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }`;
            document.head.appendChild(style);
        }

        this.elements.typingOverlay = overlay;
        this.elements.typingText = textElement;
    }

    showTypingEffect(text, duration = 30) {
        this.elements.typingOverlay.style.display = 'block';
        this.elements.typingText.textContent = '';
        let charIndex = 0;

        const typeChar = () => {
            if (charIndex < text.length) {
                this.elements.typingText.textContent += text[charIndex++];
                setTimeout(typeChar, duration);
            } else {
                setTimeout(() => this.hideTypingEffect(), 3000);
            }
        };
        typeChar();
    }

    hideTypingEffect() {
        if (!this.elements.typingOverlay) return;
        this.elements.typingOverlay.style.transition = 'opacity 0.5s ease-out';
        this.elements.typingOverlay.style.opacity = '0';
        setTimeout(() => {
            this.elements.typingOverlay.style.display = 'none';
            this.elements.typingOverlay.style.opacity = '1';
        }, 500);
    }

    showLoading(show) {
        this.elements.loading.style.display = show ? 'flex' : 'none';
        if (!show) this.elements.progressFill.style.width = '0%';
    }

    showMessage(message, type = 'info') {
        const el = document.createElement('div');
        el.className = `message ${type}`;
        el.textContent = message;
        this.elements.messageArea.appendChild(el);
        setTimeout(() => el.remove(), 5000);
    }
    
    clearMessages() {
        this.elements.messageArea.innerHTML = '';
    }

    transitionToViewport(onComplete) {
        this.elements.uploadPage.classList.add('hidden');
        this.showLoading(false);
        setTimeout(() => {
            this.elements.uploadPage.style.display = 'none';
            this.elements.viewportPage.classList.add('active');
            if (onComplete) onComplete();
        }, 500);
    }
}