/**
 * Preload script - Secure bridge between renderer and main process
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whistant', {
	// Device code linking
	submitDeviceCode: (code) => ipcRenderer.invoke('submit-device-code', code),

	// Registration
	registerServer: (data) => ipcRenderer.invoke('register-server', data),
	updateServerUrl: (data) => ipcRenderer.invoke('update-server-url', data),
	saveRegistration: (data) => ipcRenderer.invoke('save-registration', data),
	loadRegistration: () => ipcRenderer.invoke('load-registration'),

	// Browser
	openBrowser: (url) => ipcRenderer.invoke('open-browser', url),

	// Services
	checkOllama: () => ipcRenderer.invoke('check-ollama'),
	checkLoadedModels: () => ipcRenderer.invoke('check-loaded-models'),
	checkCloudflared: () => ipcRenderer.invoke('check-cloudflared'),
	getTunnelUrl: () => ipcRenderer.invoke('get-tunnel-url'),
	getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

	// Window focus helper to recover input interactivity
	focusWindow: () => ipcRenderer.invoke('focus-window'),

	// Event listeners - allow renderer to listen to events from main process
	on: (channel, listener) => ipcRenderer.on(channel, listener),
	off: (channel, listener) => ipcRenderer.off(channel, listener),
})
