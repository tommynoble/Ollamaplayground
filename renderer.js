const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const modelSelect = document.getElementById('model-select');
const refreshModelsBtn = document.getElementById('refresh-models');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const refreshDrivesBtn = document.getElementById('refresh-drives');
const drivesList = document.getElementById('drives-list');
const autoRefreshIndicator = document.getElementById('auto-refresh-indicator');
const modelsGrid = document.getElementById('models-grid');
const loadingOverlay = document.getElementById('loading-overlay');

// Global variables
let autoRefreshInterval = null;
let activeDrive = null;
let isLoading = false;
let currentModel = null;
const downloadingModels = new Set();
let downloadedModelsList = new Set(); // Track which models are already downloaded

// Check which models are already downloaded
async function checkDownloadedModels() {
    try {
        const result = await ipcRenderer.invoke('get-downloaded-models');
        
        if (result.success && result.models) {
            downloadedModelsList.clear();
            result.models.forEach(model => {
                downloadedModelsList.add(model.name);
            });
            console.log('📦 Downloaded models:', Array.from(downloadedModelsList));
        } else {
            // Fallback: try using ollama list
            const response = await fetch('http://127.0.0.1:11434/api/tags');
            if (response.ok) {
                const data = await response.json();
                downloadedModelsList.clear();
                data.models.forEach(model => {
                    downloadedModelsList.add(model.name);
                });
                console.log('📦 Downloaded models (via API):', Array.from(downloadedModelsList));
            }
        }
    } catch (error) {
        console.log('Could not check downloaded models:', error);
    }
}

// Check for existing external drive configuration on startup
async function checkExistingExternalDriveConfig() {
    try {
        // Check if there's an existing configuration
        const configCheck = await ipcRenderer.invoke('get-models-location');
        
        if (configCheck.success && configCheck.isExternal) {
            // Extract drive name from path (e.g., "/Volumes/Extreme SSD/ollama-models" -> "Extreme SSD")
            const pathParts = configCheck.path.split('/');
            const volumesIndex = pathParts.indexOf('Volumes');
            if (volumesIndex >= 0 && pathParts[volumesIndex + 1]) {
                activeDrive = pathParts[volumesIndex + 1];
                console.log(`🎯 Detected active external drive: ${activeDrive}`);
                
                // Update storage display
                await updateStorageLocationDisplay();
            }
        }
    } catch (error) {
        console.log('No existing external drive configuration found');
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    checkOllamaStatus();
    setupEventListeners();
    
    // Check for existing external drive configuration
    await checkExistingExternalDriveConfig();
    
    // Check downloaded models on startup
    await checkDownloadedModels();
    
    // Initialize home view by default
    await updateHomeStats();
    
    // Set up auto-refresh for home stats
    setInterval(updateHomeStats, 30000); // Update every 30 seconds
});



// Check Ollama status
async function checkOllamaStatus() {
    try {
        const status = await ipcRenderer.invoke('check-ollama-status');
        
        if (status.installed && status.running) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Online';
        } else if (status.installed && !status.running) {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Ollama not running';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Ollama not installed';
        }
    } catch (error) {
        console.error('Status check failed:', error);
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Error checking status';
    }
}

// Load available models
async function loadModels() {
    try {
        const result = await ipcRenderer.invoke('get-models');
        
        if (result.success && result.models.length > 0) {
            modelSelect.innerHTML = '';
            result.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
            
            // Select first model by default
            currentModel = result.models[0];
            modelSelect.value = currentModel;
        } else {
            modelSelect.innerHTML = '<option value="">No models available</option>';
        }
    } catch (error) {
        console.error('Failed to load models:', error);
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Setup navigation
    setupNavigation();
    
    // Chat functionality
    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }
    
    if (messageInput) {
        // Enter key in textarea (but allow Shift+Enter for new line)
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Auto-resize textarea
        messageInput.addEventListener('input', autoResizeTextarea);
        
        // Enable/disable send button based on input
        messageInput.addEventListener('input', updateSendButton);
    }
    
    // Model selection change
    if (modelSelect) {
        modelSelect.addEventListener('change', (e) => {
            currentModel = e.target.value;
            updateHomeStats(); // Update home page when model changes
        });
    }
    
    // Refresh models button
    if (refreshModelsBtn) {
        refreshModelsBtn.addEventListener('click', async () => {
            refreshModelsBtn.style.transform = 'rotate(180deg)';
            await loadDownloadedModels();
            await checkOllamaStatus();
            await updateHomeStats(); // Update home stats
            
            setTimeout(() => {
                refreshModelsBtn.style.transform = 'rotate(0deg)';
            }, 300);
        });
    }
    
    // Quick suggestion buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('suggestion-btn')) {
            const message = e.target.getAttribute('data-message');
            if (messageInput) {
                messageInput.value = message;
                updateSendButton();
                messageInput.focus();
            }
        }
    });

    // Settings functionality
    if (refreshDrivesBtn) {
        refreshDrivesBtn.addEventListener('click', refreshDrives);
    }
    
    // Open models folder button
    const openModelsFolderBtn = document.getElementById('open-models-folder');
    if (openModelsFolderBtn) {
        openModelsFolderBtn.addEventListener('click', openModelsLocation);
    }
    
    // Document Analyzer functionality
    const analyzeBtn = document.getElementById('analyze-btn');
    const summarizeBtn = document.getElementById('summarize-btn');
    const extractBtn = document.getElementById('extract-btn');
    
    if (analyzeBtn) analyzeBtn.addEventListener('click', () => analyzeText('analyze'));
    if (summarizeBtn) summarizeBtn.addEventListener('click', () => analyzeText('summarize'));
    if (extractBtn) extractBtn.addEventListener('click', () => analyzeText('extract'));
    
    // Code Assistant functionality
    const generateBtn = document.getElementById('generate-btn');
    const reviewBtn = document.getElementById('review-btn');
    const explainBtn = document.getElementById('explain-btn');
    
    if (generateBtn) generateBtn.addEventListener('click', () => processCode('generate'));
    if (reviewBtn) reviewBtn.addEventListener('click', () => processCode('review'));
    if (explainBtn) explainBtn.addEventListener('click', () => processCode('explain'));

    // Listen for download progress
    ipcRenderer.on('download-progress', (event, data) => {
        updateDownloadProgress(data);
    });
}

// Enhanced auto-resize textarea with smooth transitions
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    const maxHeight = 160; // Match CSS max-height
    const minHeight = 24;  // Match CSS min-height
    const newHeight = Math.max(minHeight, Math.min(messageInput.scrollHeight, maxHeight));
    messageInput.style.height = newHeight + 'px';
    
    // Add visual feedback for overflow
    if (messageInput.scrollHeight > maxHeight) {
        messageInput.style.overflowY = 'auto';
    } else {
        messageInput.style.overflowY = 'hidden';
    }
}

// Update send button state
function updateSendButton() {
    const hasText = messageInput.value.trim().length > 0;
    sendButton.disabled = !hasText || isLoading;
}

// Enhanced Chat Functions with phi model optimizations
async function sendMessage() {
    const message = messageInput.value.trim();
    const selectedModel = modelSelect.value;
    
    if (!message) return;
    if (!selectedModel) {
        addMessage('Please select a model first.', 'system');
        return;
    }
    
    // Add user message to chat
    addMessage(message, 'user');
    messageInput.value = '';
    autoResizeTextarea(); // Reset textarea height
    
    // Check for special commands
    if (await handleSpecialCommands(message, selectedModel)) {
        return;
    }
    
    try {
        // Show enhanced typing indicator
        const typingDiv = document.createElement('div');
        typingDiv.classList.add('message', 'assistant', 'typing');
        typingDiv.innerHTML = `
            <div class="message-header">
                <span class="sender">Assistant</span>
                <span class="model-badge">${selectedModel}</span>
            </div>
            <div class="message-content">
                <div class="typing-animation">
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                </div>
                <span class="thinking-text">Thinking...</span>
            </div>
        `;
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Send message to backend with timing
        const startTime = Date.now();
        const response = await ipcRenderer.invoke('chat-message', message, selectedModel);
        const responseTime = Date.now() - startTime;
        
        // Remove typing indicator
        typingDiv.remove();
        
        if (response.success) {
            // Add formatted response with metadata
            addEnhancedMessage(response.message, 'assistant', {
                model: selectedModel,
                responseTime: responseTime,
                tokens: response.tokens,
                duration: response.duration
            });
        } else {
            // Handle external drive requirement
            if (response.requiresExternalDrive) {
                addMessage('⚙️ External storage required. Please configure in Settings.', 'system');
            } else {
                addMessage(`❌ Error: ${response.error}`, 'system');
                
                // Add helpful suggestions for common errors
                if (response.error.includes('not running')) {
                    addMessage('💡 Try: Run "ollama serve" in your terminal to start the Ollama server.', 'system');
                } else if (response.error.includes('timed out')) {
                    addMessage('💡 Try: Use a smaller model or ask a simpler question.', 'system');
                }
            }
        }
    } catch (error) {
        // Remove typing indicator
        const typingIndicator = document.querySelector('.typing');
        if (typingIndicator) typingIndicator.remove();
        
        addMessage(`❌ Unexpected error: ${error.message}`, 'system');
        console.error('Chat error:', error);
    }
}

// Handle special chat commands
async function handleSpecialCommands(message, selectedModel) {
    const lowerMessage = message.toLowerCase();
    
    // Model switching
    const modelSwitchPattern = /(?:use|switch to|load)\s+(\w+)/i;
    const match = message.match(modelSwitchPattern);
    
    if (match) {
        const requestedModel = match[1].toLowerCase();
        const availableModels = Array.from(modelSelect.options).map(opt => opt.value);
        
        const modelMatch = availableModels.find(model => 
            model.toLowerCase().includes(requestedModel) || 
            requestedModel.includes(model.toLowerCase())
        );
        
        if (modelMatch) {
            modelSelect.value = modelMatch;
            currentModel = modelMatch;
            addMessage(`✅ Switched to ${modelMatch}`, 'system');
            await updateHomeStats(); // Update home stats when model changes
            return true;
        } else {
            addMessage(`❌ Model "${requestedModel}" not found. Available models: ${availableModels.join(', ')}`, 'system');
            return true;
        }
    }
    
    // Clear conversation
    if (lowerMessage.includes('/clear') || lowerMessage.includes('clear conversation')) {
        try {
            await ipcRenderer.invoke('clear-conversation', selectedModel);
            addMessage(`🗑️ Conversation history cleared for ${selectedModel}`, 'system');
            return true;
        } catch (error) {
            addMessage(`❌ Failed to clear conversation: ${error.message}`, 'system');
            return true;
        }
    }
    
    // Show conversation history
    if (lowerMessage.includes('/history') || lowerMessage.includes('show history')) {
        try {
            const historyResponse = await ipcRenderer.invoke('get-conversation-history', selectedModel);
            if (historyResponse.success && historyResponse.history.length > 0) {
                addMessage(`📚 Conversation has ${historyResponse.history.length / 2} exchanges`, 'system');
            } else {
                addMessage('📭 No conversation history yet', 'system');
            }
            return true;
        } catch (error) {
            addMessage(`❌ Failed to get history: ${error.message}`, 'system');
            return true;
        }
    }
    
    // Help command
    if (lowerMessage.includes('/help') || lowerMessage === 'help') {
        const helpMessage = `
🤖 **Chat Commands:**
• \`/clear\` - Clear conversation history
• \`/history\` - Show conversation stats  
• \`use [model]\` - Switch to a different model
• \`/help\` - Show this help

💡 **Tips for better responses:**
• Be specific and clear in your questions
• Provide context for complex topics
• Use follow-up questions to dive deeper
• Try different phrasings if you don't get the answer you want
        `;
        addMessage(helpMessage.trim(), 'system');
        return true;
    }
    
    return false;
}

// Enhanced message display with metadata
function addEnhancedMessage(content, sender = 'user', metadata = {}) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender);
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedContent = formatMessage(content);
    
    if (sender === 'assistant' && metadata) {
        const responseTimeText = metadata.responseTime ? ` (${Math.round(metadata.responseTime / 1000)}s)` : '';
        const tokenInfo = metadata.tokens ? ` • ${metadata.tokens} tokens` : '';
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="sender">Assistant</span>
                <span class="model-badge">${metadata.model || 'AI'}</span>
                <span class="timestamp">${timestamp}${responseTimeText}</span>
            </div>
            <div class="message-content">${formattedContent}</div>
            <div class="message-metadata">
                <span class="metadata-info">💬 High-quality response${tokenInfo}</span>
                <button class="copy-btn" onclick="copyMessage(this)" title="Copy message">📋</button>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="sender">${sender === 'user' ? 'You' : 'Assistant'}</span>
                <span class="timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${formattedContent}</div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Enhanced message formatting with better code highlighting
function formatMessage(content) {
    // Escape HTML first
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    let formatted = escapeHtml(content);
    
    // Enhanced code block formatting with language detection
    formatted = formatted.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'text';
        return `<div class="code-block">
            <div class="code-header">
                <span class="code-lang">${language}</span>
                <button class="copy-code-btn" onclick="copyCode(this)" title="Copy code">📋</button>
            </div>
            <pre><code class="language-${language}">${code.trim()}</code></pre>
        </div>`;
    });
    
    // Inline code formatting
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    
    // Enhanced text formatting
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/__(.*?)__/g, '<u>$1</u>');
    
    // Convert line breaks while preserving code blocks
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Add emoji reactions for better UX
    formatted = formatted.replace(/:\)/g, '😊');
    formatted = formatted.replace(/:\(/g, '😔');
    formatted = formatted.replace(/:D/g, '😄');
    formatted = formatted.replace(/:\|/g, '😐');
    
    return formatted;
}

// Copy message functionality
function copyMessage(button) {
    const messageContent = button.closest('.message').querySelector('.message-content');
    const text = messageContent.textContent || messageContent.innerText;
    
    navigator.clipboard.writeText(text).then(() => {
        button.textContent = '✅';
        setTimeout(() => {
            button.textContent = '📋';
        }, 2000);
    }).catch(() => {
        button.textContent = '❌';
        setTimeout(() => {
            button.textContent = '📋';
        }, 2000);
    });
}

// Copy code functionality
function copyCode(button) {
    const codeBlock = button.closest('.code-block').querySelector('code');
    const text = codeBlock.textContent || codeBlock.innerText;
    
    navigator.clipboard.writeText(text).then(() => {
        button.textContent = '✅';
        setTimeout(() => {
            button.textContent = '📋';
        }, 2000);
    }).catch(() => {
        button.textContent = '❌';
        setTimeout(() => {
            button.textContent = '📋';
        }, 2000);
    });
}

// Add system message support (keeping existing function but enhanced)
function addMessage(content, sender = 'user') {
    if (sender === 'assistant') {
        // Use enhanced message for assistant responses
        addEnhancedMessage(content, sender);
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender);
    
    if (sender === 'system') {
        messageDiv.innerHTML = `
            <div class="message-content system-message">
                <span class="system-icon">ℹ️</span>
                ${formatMessage(content)}
            </div>
        `;
    } else {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="sender">${sender === 'user' ? 'You' : 'Assistant'}</span>
                <span class="timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${formatMessage(content)}</div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Basic message formatting
function formatMessage(content) {
    // Escape HTML first
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    let formatted = escapeHtml(content);
    
    // Simple code block formatting (```code```)
    formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    // Inline code formatting (`code`)
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold formatting (**text**)
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
}

// Set loading state
function setLoading(loading) {
    isLoading = loading;
    
    if (loading) {
        loadingOverlay.classList.remove('hidden');
    } else {
        loadingOverlay.classList.add('hidden');
    }
    
    updateSendButton();
}

// Settings Functions (moved from modal system)
let driveRefreshInterval = null;

async function refreshDrives() {
    // Only show scanning message if drives list is empty
    if (drivesList.children.length === 0 || drivesList.innerHTML.includes('scanning-drives')) {
        drivesList.innerHTML = '<div class="scanning-drives">Scanning for drives...</div>';
    }
    
    try {
        const result = await ipcRenderer.invoke('detect-external-drives');
        
        if (result.success) {
            displayDrives(result.drives);
        } else {
            drivesList.innerHTML = `<div class="scanning-drives">Error: ${result.error}</div>`;
        }
    } catch (error) {
        console.error('Drive detection failed:', error);
        drivesList.innerHTML = '<div class="scanning-drives">Failed to detect drives</div>';
    }
}

function displayDrives(drives) {
    if (drives.length === 0) {
        drivesList.innerHTML = '<div class="scanning-drives">No external drives found</div>';
        return;
    }
    
    drivesList.innerHTML = drives.map(drive => `
        <div class="drive-item">
            <div class="drive-info">
                <div class="drive-icon">💾</div>
                <div class="drive-details">
                    <h4>${drive.name}</h4>
                    <p>${drive.path}</p>
                </div>
            </div>
            <div class="drive-actions">
                <button class="use-drive-btn ${activeDrive === drive.name ? 'active' : ''}" 
                        onclick="useDrive('${drive.name}', '${drive.path}', this)"
                        ${activeDrive === drive.name ? 'disabled' : ''}>
                    ${activeDrive === drive.name ? 'Currently Used ✓' : 'Use for Models'}
                </button>
                <button class="eject-btn" onclick="showEjectOptions('${drive.name}')">
                    ⏏️ Eject
                </button>
            </div>
        </div>
    `).join('');
}

function showEjectOptions(driveName) {
    const choice = confirm(`Choose eject method for "${driveName}":
    
OK = Normal Eject (safer)
Cancel = Force Eject (if normal fails)`);
    
    if (choice) {
        ejectDrive(driveName, false); // Normal eject
    } else {
        ejectDrive(driveName, true);  // Force eject
    }
}

async function ejectDrive(driveName, force = false) {
    const ejectType = force ? "force eject" : "eject";
    
    try {
        const result = await ipcRenderer.invoke('eject-drive', driveName, force);
        
        if (result.success) {
            alert(`Drive "${driveName}" ejected successfully`);
            refreshDrives(); // Refresh the list
        } else {
            const errorMsg = result.error || 'Unknown error';
            if (!force && errorMsg.includes('could not be unmounted')) {
                // Offer force eject as alternative
                if (confirm(`Normal eject failed because something is using the drive. Try force eject?\n\nError: ${errorMsg}`)) {
                    ejectDrive(driveName, true);
                }
            } else {
                alert(`Failed to ${ejectType} drive: ${errorMsg}`);
            }
        }
    } catch (error) {
        console.error('Eject failed - full error object:', error);
        console.error('Error type:', typeof error);
        console.error('Error keys:', Object.keys(error));
        
        let errorMsg = 'Unknown error';
        
        // Try different ways to extract the error message
        if (typeof error === 'string') {
            errorMsg = error;
        } else if (error && error.error) {
            errorMsg = error.error;
        } else if (error && error.message) {
            errorMsg = error.message;
        } else if (error && error.toString) {
            errorMsg = error.toString();
        } else {
            errorMsg = JSON.stringify(error);
        }
        
        if (!force && errorMsg.includes('could not be unmounted')) {
            if (confirm(`Normal eject failed. Try force eject?\n\nError: ${errorMsg}`)) {
                ejectDrive(driveName, true);
            }
        } else {
            alert(`Failed to ${ejectType} drive: ${errorMsg}`);
        }
    }
}

async function useDrive(driveName, drivePath, buttonElement) {
    // Show confirmation dialog with details
    const confirmMessage = `Use external drive "${driveName}" for all model storage?

📍 Drive Location: ${drivePath}
📁 Models Folder: ${drivePath}/ollama-models/

ℹ️  What will happen:
• All new model downloads will go to external drive
• Your existing local models will be moved to external drive
• Local computer storage will stay lightweight
• You'll need to manually restart Ollama after this change

⚠️  Note: This app requires external storage to prevent local storage bloat.

Do you want to continue?`;

    if (!confirm(confirmMessage)) {
        return; // User cancelled
    }

    // Show loading state
    const button = buttonElement;
    const originalText = button.textContent;
    button.textContent = 'Setting up...';
    button.disabled = true;

    // Call the backend to set up external drive
    try {
        const result = await ipcRenderer.invoke('use-for-models', driveName, drivePath);
        
        if (result.success) {
            // Show success message with restart instruction
            alert(`✅ Success! External drive "${driveName}" is now permanently configured for all model downloads.

📁 All future models will automatically download to:
${result.modelsPath}

🎯 Setup complete! No manual configuration needed.
All downloads will now go to your external drive automatically.`);

            // Store which drive is active
            activeDrive = driveName;
            
            // Update button state
            button.textContent = 'Currently Used ✓';
            button.classList.add('active');
            button.disabled = true;

            // Update storage location display
            await updateStorageLocationDisplay();

            // Don't refresh drives list to avoid overwriting our button state
        } else {
            // Show error message
            alert(`❌ Failed to setup external drive: ${result.error}`);
            
            // Restore button state
            button.textContent = originalText;
            button.disabled = false;
        }
    } catch (error) {
        alert(`❌ Error: ${error.message || error}`);
        
        // Restore button state
        button.textContent = originalText;
        button.disabled = false;
    }
}

// Model Browser Functions  
async function loadAvailableModels() {
    // First, check which models are already downloaded
    await checkDownloadedModels();
    
    // Hardcoded popular models for instant display
    const models = [
        {
            name: 'llama2',
            variants: ['7b', '13b', '70b'],
            description: 'Meta\'s Llama 2 model, excellent for general conversation and reasoning',
            tags: ['general', 'reasoning'],
            sizes: { '7b': '3.8GB', '13b': '7.3GB', '70b': '39GB' },
            downloadTime: { '7b': '5-10 min', '13b': '10-15 min', '70b': '45-60 min' }
        },
        {
            name: 'mistral',
            variants: ['7b'],
            description: 'Fast and capable model, great balance of performance and speed',
            tags: ['general', 'fast'],
            sizes: { '7b': '4.1GB' },
            downloadTime: { '7b': '6-12 min' }
        },
        {
            name: 'codellama',
            variants: ['7b', '13b', '34b'],
            description: 'Code generation and programming assistance model',
            tags: ['coding', 'programming'],
            sizes: { '7b': '3.8GB', '13b': '7.3GB', '34b': '19GB' },
            downloadTime: { '7b': '5-10 min', '13b': '10-15 min', '34b': '25-35 min' }
        },
        {
            name: 'phi3',
            variants: ['mini', 'small', 'medium'],
            description: 'Microsoft\'s efficient small language model, very fast',
            tags: ['fast', 'efficient'],
            sizes: { 'mini': '2.3GB', 'small': '7.9GB', 'medium': '14GB' },
            downloadTime: { 'mini': '3-6 min', 'small': '10-15 min', 'medium': '18-25 min' }
        },
        {
            name: 'gemma',
            variants: ['2b', '7b'],
            description: 'Google\'s Gemma model family, lightweight and powerful',
            tags: ['general', 'efficient'],
            sizes: { '2b': '1.4GB', '7b': '5.0GB' },
            downloadTime: { '2b': '2-4 min', '7b': '7-12 min' }
        },
        {
            name: 'neural-chat',
            variants: ['7b'],
            description: 'Fine-tuned for helpful, harmless, and honest conversations',
            tags: ['chat', 'helpful'],
            sizes: { '7b': '4.1GB' },
            downloadTime: { '7b': '6-12 min' }
        }
    ];
    
    // Display models instantly
    displayAvailableModels(models);
}

function createModelCard(model, variant) {
    const card = document.createElement('div');
    card.className = 'model-card';
    
    const fullName = `${model.name}:${variant}`;
    const isDownloading = downloadingModels.has(fullName);
    const isDownloaded = downloadedModelsList.has(fullName);
    
    // Determine button state and styling
    let buttonClass = 'download-model-btn';
    let buttonText = 'Download Model';
    let buttonDisabled = '';
    let buttonAction = `downloadModel('${model.name}', '${variant}')`;
    
    if (isDownloaded) {
        buttonClass = 'download-model-btn downloaded';
        buttonText = 'Downloaded ✓';
        buttonDisabled = 'disabled';
        buttonAction = ''; // No action for downloaded models
        card.classList.add('downloaded');
    } else if (isDownloading) {
        buttonText = 'Downloading...';
        buttonDisabled = 'disabled';
    }
    
    // Create all content in one operation to avoid reflows
    card.innerHTML = `
        <div class="model-header">
            <div class="model-name">${model.name}:${variant}</div>
            <div class="model-size">${model.sizes[variant]}</div>
            ${isDownloaded ? '<div class="downloaded-badge">✅ Downloaded</div>' : ''}
        </div>
        <div class="model-description">${model.description}</div>
        <div class="model-meta">
            <div class="model-tags">
                ${model.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
            <div class="download-time">⏱️ ${isDownloaded ? 'Ready to use' : model.downloadTime[variant]}</div>
        </div>
        <div class="download-progress" id="progress-${fullName.replace(':', '-')}" style="display: none;">
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-text">Preparing download...</div>
        </div>
        <div class="model-actions">
            <button class="${buttonClass}" onclick="${buttonAction}" ${buttonDisabled}>
                ${buttonText}
            </button>
            <button class="open-location-btn" onclick="openModelsLocation()" title="Open models location">
                📁
            </button>
        </div>
    `;
    
    return card;
}

function displayAvailableModels(models) {
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    models.forEach(model => {
        model.variants.forEach(variant => {
            const modelCard = createModelCard(model, variant);
            fragment.appendChild(modelCard);
        });
    });
    
    // Clear and append all at once to avoid multiple reflows
    modelsGrid.innerHTML = '';
    modelsGrid.appendChild(fragment);
}

async function downloadModel(modelName, variant) {
    const fullName = `${modelName}:${variant}`;
    
    // Check if external drive is configured
    try {
        // For now, let's skip the external drive check and allow direct downloads
        console.log(`Starting download of ${fullName}`);
    } catch (error) {
        console.log('External drive check skipped, proceeding with download');
    }
    
    // Find the button that was clicked
    const buttons = document.querySelectorAll('.download-model-btn');
    let buttonElement = null;
    
    for (const btn of buttons) {
        const onClick = btn.getAttribute('onclick');
        if (onClick && onClick.includes(`'${modelName}'`) && onClick.includes(`'${variant}'`)) {
            buttonElement = btn;
            break;
        }
    }
    
    if (!buttonElement) {
        console.error('Could not find download button');
        return;
    }
    
    // Update UI
    downloadingModels.add(fullName);
    buttonElement.textContent = 'Downloading...';
    buttonElement.disabled = true;
    buttonElement.style.background = '#6c757d';
    
    // Show progress container
    const modelId = fullName.replace(':', '-');
    const progressContainer = document.getElementById(`progress-${modelId}`);
    if (progressContainer) {
        progressContainer.style.display = 'block';
        progressContainer.className = 'download-progress preparing';
        const progressText = progressContainer.querySelector('.progress-text');
        if (progressText) {
            progressText.textContent = 'Starting download...';
        }
    }
    
    try {
        const result = await require('electron').ipcRenderer.invoke('download-model', modelName, variant);
        
        if (result.success) {
            buttonElement.textContent = 'Downloaded ✓';
            buttonElement.style.background = '#28a745';
            
            // Show success message
            addMessage(`Successfully downloaded ${fullName}! You can now select it from the model dropdown.`, 'system');
            
            // Refresh model selector and model cards to show downloaded status
            await loadDownloadedModels();
            await loadAvailableModels(); // Refresh the model cards to show downloaded state
            
            setTimeout(() => {
                buttonElement.textContent = 'Download Model';
                buttonElement.disabled = false;
                buttonElement.style.background = '#007bff';
                downloadingModels.delete(fullName);
                
                // Hide progress container
                if (progressContainer) {
                    progressContainer.style.display = 'none';
                }
            }, 3000);
        } else {
            buttonElement.textContent = 'Download Failed';
            buttonElement.style.background = '#dc3545';
            
            // Show error message
            addMessage(`Failed to download ${fullName}: ${result.error}`, 'system');
            
            setTimeout(() => {
                buttonElement.textContent = 'Download Model';
                buttonElement.disabled = false;
                buttonElement.style.background = '#007bff';
                downloadingModels.delete(fullName);
                
                // Hide progress container
                if (progressContainer) {
                    progressContainer.style.display = 'none';
                }
            }, 3000);
        }
    } catch (error) {
        console.error('Download error:', error);
        buttonElement.textContent = 'Download Failed';
        buttonElement.style.background = '#dc3545';
        
        addMessage(`Download error for ${fullName}: ${error.message}`, 'system');
        
        setTimeout(() => {
            buttonElement.textContent = 'Download Model';
            buttonElement.disabled = false;
            buttonElement.style.background = '#007bff';
            downloadingModels.delete(fullName);
            
            // Hide progress container
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
        }, 3000);
    }
}

// Open models location in Finder
async function openModelsLocation() {
    try {
        const result = await ipcRenderer.invoke('open-models-location');
        
        if (result.success) {
            // Show brief confirmation message
            const statusMsg = document.createElement('div');
            statusMsg.className = 'location-opened-msg';
            statusMsg.textContent = `📁 Opened: ${result.path}`;
            statusMsg.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #28a745;
                color: white;
                padding: 12px 16px;
                border-radius: 6px;
                z-index: 9999;
                font-size: 14px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            `;
            
            document.body.appendChild(statusMsg);
            
            // Remove after 3 seconds
            setTimeout(() => {
                if (statusMsg.parentNode) {
                    statusMsg.parentNode.removeChild(statusMsg);
                }
            }, 3000);
        } else {
            alert('Failed to open models location: ' + result.error);
        }
    } catch (error) {
        alert('Error opening models location: ' + error.message);
    }
}

// Enhanced download progress handler
function updateDownloadProgress(data) {
    console.log('📊 Progress update received:', data); // Debug logging
    
    const modelId = data.model.replace(':', '-');
    const progressContainer = document.getElementById(`progress-${modelId}`);
    
    if (!progressContainer) {
        console.warn(`Progress container not found for ${modelId}`);
        return;
    }
    
    const progressBar = progressContainer.querySelector('.progress-fill');
    const progressText = progressContainer.querySelector('.progress-text');
    
    if (!progressBar || !progressText) {
        console.warn('Progress bar elements not found');
        return;
    }
    
    // Show progress container
    progressContainer.style.display = 'block';
    
    // Update progress bar class for styling
    progressContainer.className = `download-progress ${data.status}`;
    
    // Update progress bar width with animation
    if (data.percentage !== null && data.percentage !== undefined) {
        progressBar.style.width = `${Math.min(100, Math.max(0, data.percentage))}%`;
    } else {
        // Show some progress even without specific percentage
        if (data.status === 'preparing') {
            progressBar.style.width = '15%';
        } else if (data.status === 'downloading') {
            progressBar.style.width = '50%'; // Generic downloading state
        } else if (data.status === 'verifying') {
            progressBar.style.width = '90%';
        }
    }
    
    // Build progress text
    let displayText = data.message || 'Processing...';
    
    if (data.status === 'downloading' && data.percentage !== null) {
        displayText = `Downloading ${data.percentage}%`;
        
        if (data.speed) {
            displayText += ` at ${data.speed}`;
        }
        
        if (data.size) {
            displayText += ` (${data.size})`;
        }
    } else if (data.status === 'preparing') {
        displayText = 'Preparing download...';
    } else if (data.status === 'verifying') {
        displayText = 'Verifying download...';
    } else if (data.status === 'completed') {
        displayText = 'Download completed! ✅';
        progressBar.style.width = '100%';
        
        // Hide progress after 3 seconds
        setTimeout(() => {
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
        }, 3000);
    }
    
    progressText.textContent = displayText;
    
    // Force redraw to ensure progress is visible
    progressContainer.offsetHeight;
}

async function loadDownloadedModels() {
    try {
        const result = await require('electron').ipcRenderer.invoke('get-downloaded-models');
        
        if (result.success && result.models) {
            // Update model selector - EXTERNAL DRIVE MODELS ONLY
            const currentValue = modelSelect.value;
            modelSelect.innerHTML = '<option value="">Select a model...</option>';
            
            result.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = `${model.name} (${model.size})`;
                modelSelect.appendChild(option);
            });
            
            if (result.models.length === 0) {
                modelSelect.innerHTML = '<option value="">No models on external drive - download some first</option>';
            }
            
            // Restore previous selection if still available
            if (currentValue && Array.from(modelSelect.options).some(opt => opt.value === currentValue)) {
                modelSelect.value = currentValue;
            }
        } else {
            // Handle external drive requirement
            if (result.requiresExternalDrive) {
                modelSelect.innerHTML = '<option value="">🚫 External drive required - Go to Settings</option>';
                
                // Show warning in home stats
                const activeModelElement = document.getElementById('active-model');
                if (activeModelElement) {
                    activeModelElement.textContent = 'External Drive Required';
                    activeModelElement.style.color = '#dc3545';
                }
                

            } else {
                modelSelect.innerHTML = '<option value="">Error loading models</option>';
            }
        }
    } catch (error) {
        console.error('Failed to load downloaded models:', error);
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
}

function displayDownloadedModels(models) {
    if (models.length === 0) {
        downloadedModelsList.innerHTML = '<div class="no-models">No models downloaded yet</div>';
        return;
    }
    
    downloadedModelsList.innerHTML = '';
    
    models.forEach(model => {
        const modelElement = document.createElement('div');
        modelElement.className = 'downloaded-model';
        
        modelElement.innerHTML = `
            <div class="downloaded-model-info">
                <div class="downloaded-model-name">${model.name}</div>
                <div class="downloaded-model-size">${model.size}</div>
            </div>
            <div class="downloaded-model-actions">
                <button class="use-model-btn" onclick="useModel('${model.name}')">Use in Chat</button>
                <button class="delete-model-btn" onclick="deleteModel('${model.name}')">Delete</button>
            </div>
        `;
        
        downloadedModelsList.appendChild(modelElement);
    });
}

async function useModel(modelName) {
    // Set the model in the chat selector
    const modelOption = Array.from(modelSelect.options).find(option => option.value === modelName);
    if (modelOption) {
        modelSelect.value = modelName;
        closeSettings();
        
        // Add a system message to indicate model switch
        addMessage(`Switched to ${modelName}`, 'system');
    } else {
        // Add model to selector if not present
        const option = document.createElement('option');
        option.value = modelName;
        option.textContent = modelName;
        modelSelect.appendChild(option);
        modelSelect.value = modelName;
        closeSettings();
        
        addMessage(`Switched to ${modelName}`, 'system');
    }
}

async function deleteModel(modelName) {
    if (confirm(`Are you sure you want to delete ${modelName}? This will free up space on your external drive.`)) {
        try {
            const result = await ipcRenderer.invoke('delete-model', modelName);
            
            if (result.success) {
                await loadDownloadedModels();
                await loadModels(); // Refresh model selector
                addMessage(`Deleted model ${modelName}`, 'system');
            } else {
                alert('Failed to delete model: ' + result.error);
            }
        } catch (error) {
            alert('Error deleting model: ' + error.message);
        }
    }
}

// Periodic status check
setInterval(checkOllamaStatus, 30000); // Check every 30 seconds 

// Update storage location display
async function updateStorageLocationDisplay() {
    const storagePathElement = document.getElementById('current-storage-path');
    const storageTypeElement = document.querySelector('.storage-type');
    const storageNoteElement = document.querySelector('.storage-note');
    
    if (!storagePathElement || !storageTypeElement || !storageNoteElement) return;
    
    try {
        const configCheck = await ipcRenderer.invoke('get-models-location');
        
        if (configCheck.success && configCheck.isExternal) {
            // External drive is configured
            storagePathElement.textContent = configCheck.path;
            storageTypeElement.className = 'storage-type external';
            storageTypeElement.textContent = '✅ External Drive';
            storageNoteElement.textContent = 'All model downloads automatically go to your external drive. Your computer stays lightweight!';
        } else {
            // Using local storage
            storagePathElement.textContent = 'External drive required';
            storageTypeElement.className = 'storage-type local';
            storageTypeElement.textContent = '⚠️ Lightweight App';
            storageNoteElement.textContent = 'This app requires external storage to prevent local storage bloat. Please select an external drive for model storage.';
        }
    } catch (error) {
        console.log('Could not determine storage location');
    }
} 

// Navigation and View Management
function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetView = btn.getAttribute('data-view');
            switchToView(targetView);
            
            // Update active nav button
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function switchToView(viewName) {
    // Hide all views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    
    // Show target view
    const targetView = document.getElementById(`${viewName}-view`);
    if (targetView) {
        targetView.classList.add('active');
        
        // Initialize view-specific functionality
        initializeView(viewName);
    }
}

async function initializeView(viewName) {
    switch(viewName) {
        case 'home':
            await updateHomeStats();
            break;
        case 'chat':
            await loadDownloadedModels();
            break;
        case 'models':
            await updateStorageLocationDisplay();
            await loadAvailableModels();
            break;
        case 'settings':
            await checkExistingExternalDriveConfig();
            refreshDrives();
            break;
        case 'analyzer':
            await populateModelSelects();
            break;
        case 'coder':
            await populateModelSelects();
            break;
    }
}



// Update Home Page Statistics
async function updateHomeStats() {
    try {
        // Update downloaded models count
        await checkDownloadedModels();
        const downloadedCount = downloadedModelsList.size;
        const downloadedCountElement = document.getElementById('downloaded-count');
        if (downloadedCountElement) {
            downloadedCountElement.textContent = downloadedCount;
        }
        
        // Update storage location (using get-models-location to avoid popup)
        const configCheck = await ipcRenderer.invoke('get-models-location');
        const storageElement = document.getElementById('storage-location');
        if (storageElement && configCheck.success) {
            if (configCheck.isExternal) {
                storageElement.textContent = 'External';
            } else {
                storageElement.textContent = 'Local';
            }
        } else {
            if (storageElement) {
                storageElement.textContent = 'Not Set';
            }
        }
        
        // Update active model
        const modelSelect = document.getElementById('model-select');
        const activeModelElement = document.getElementById('active-model');
        if (activeModelElement) {
            if (modelSelect && modelSelect.value) {
                activeModelElement.textContent = modelSelect.value;
            } else if (downloadedCount > 0) {
                activeModelElement.textContent = Array.from(downloadedModelsList)[0] || 'Available';
            } else {
                activeModelElement.textContent = 'None';
            }
        }
    } catch (error) {
        console.log('Could not update home stats:', error);
    }
}

// Populate model selects for analyzer and coder
async function populateModelSelects() {
    await checkDownloadedModels();
    
    const analyzerSelect = document.getElementById('analyzer-model-select');
    const coderSelect = document.getElementById('coder-model-select');
    
    if (analyzerSelect) {
        analyzerSelect.innerHTML = '<option value="">Select analysis model...</option>';
        downloadedModelsList.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            analyzerSelect.appendChild(option);
        });
    }
    
    if (coderSelect) {
        coderSelect.innerHTML = '<option value="">Select coding model...</option>';
        downloadedModelsList.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            coderSelect.appendChild(option);
        });
    }
}

// Document Analyzer Functions
async function analyzeText(action = 'analyze') {
    const textInput = document.getElementById('text-input');
    const modelSelect = document.getElementById('analyzer-model-select');
    const resultsDiv = document.getElementById('analysis-results');
    
    const text = textInput.value.trim();
    const model = modelSelect.value;
    
    if (!text) {
        alert('Please enter some text to analyze');
        return;
    }
    
    if (!model) {
        alert('Please select a model for analysis');
        return;
    }
    
    let prompt = '';
    switch(action) {
        case 'summarize':
            prompt = `Please provide a concise summary of the following text:\n\n${text}`;
            break;
        case 'extract':
            prompt = `Please extract the key points from the following text as a bulleted list:\n\n${text}`;
            break;
        default:
            prompt = `Please analyze the following text and provide insights:\n\n${text}`;
    }
    
    resultsDiv.innerHTML = '<div class="loading">🔄 Analyzing...</div>';
    
    try {
        const response = await ipcRenderer.invoke('chat-message', prompt, model);
        
        if (response.success) {
            resultsDiv.innerHTML = `<pre>${response.message}</pre>`;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${response.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
}

// Code Assistant Functions
async function processCode(action = 'generate') {
    const codeInput = document.getElementById('code-input');
    const modelSelect = document.getElementById('coder-model-select');
    const languageSelect = document.getElementById('language-select');
    const resultsDiv = document.getElementById('code-results');
    
    const input = codeInput.value.trim();
    const model = modelSelect.value;
    const language = languageSelect.value;
    
    if (!input) {
        alert('Please enter a description or code');
        return;
    }
    
    if (!model) {
        alert('Please select a model for code assistance');
        return;
    }
    
    let prompt = '';
    switch(action) {
        case 'generate':
            prompt = `Generate ${language} code for the following request:\n\n${input}\n\nPlease provide clean, well-commented code.`;
            break;
        case 'review':
            prompt = `Please review the following ${language} code and suggest improvements:\n\n${input}`;
            break;
        case 'explain':
            prompt = `Please explain how this ${language} code works:\n\n${input}`;
            break;
    }
    
    resultsDiv.innerHTML = '<div class="loading">🔄 Processing...</div>';
    
    try {
        const response = await ipcRenderer.invoke('chat-message', prompt, model);
        
        if (response.success) {
            resultsDiv.innerHTML = `<pre>${response.message}</pre>`;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${response.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
} 