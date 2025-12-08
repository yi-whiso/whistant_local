/**
 * Whistant Desktop App - Renderer Process
 * Device linking via code from iPhone app (reverse flow)
 */

let isSubmitting = false

// Ensure window gets focus (helps with Electron input freeze until minimize/restore)
async function ensureWindowFocus() {
	try {
		window.focus()
		await window.whistant?.focusWindow?.()
	} catch (e) {
		// best-effort
	}
}

// Ensure link code form is always usable
function enableLinkCodeInput() {
	let codeInput = document.getElementById('link-code-input')
	const submitBtn = document.getElementById('submit-code-btn')

	// Reset input in place (avoid replacing node to preserve keyboard handling)
	if (codeInput) {
		codeInput.value = ''
		codeInput.disabled = false
		codeInput.readOnly = false
		codeInput.style.pointerEvents = 'auto'
		codeInput.removeAttribute('disabled')
		codeInput.removeAttribute('readonly')
		// Briefly toggle disabled to nudge Electron to repaint input state
		codeInput.disabled = true
		void codeInput.offsetHeight
		codeInput.disabled = false
		// Focus after window is ensured active and after a frame
		ensureWindowFocus()
		requestAnimationFrame(() => {
			codeInput.blur()
			codeInput.focus({ preventScroll: true })
			try { codeInput.setSelectionRange(0, 0) } catch (e) {}
		})
	}

	if (submitBtn) {
		submitBtn.disabled = false
		submitBtn.textContent = 'Link Server'
		submitBtn.style.pointerEvents = 'auto'
	}

	isSubmitting = false
}

/**
 * Initialize app on load
 */
window.addEventListener('DOMContentLoaded', async () => {
	console.log('🚀 Whistant starting...')

	// Start monitoring services in background
	startStatusMonitoring()

	// Check if already registered
	const registration = await window.whistant.loadRegistration()
	if (registration && registration.registered) {
		// Successfully registered with Whistant server - show success screen
		document.getElementById('success-username').textContent = registration.username || '-'
		document.getElementById('success-server-id').textContent = registration.serverId || '-'
		document.getElementById('success-os').textContent = registration.os || '-'
		document.getElementById('success-device').textContent = registration.device || '-'
		document.getElementById('success-model').textContent = registration.model || '-'
		document.getElementById('success-url').textContent = registration.url || '-'
		document.getElementById('success-nvidia-driver').textContent = registration.nvidiaDriver || '-'
		document.getElementById('success-cuda-version').textContent = registration.cudaVersion || '-'
		showScreen('screen-success')
	} else {
		// Show check ollama screen and wait for it
		showScreen('screen-check-ollama')
		await waitForOllama()
	}
})

/**
 * Wait for Ollama to be ready
 */
async function waitForOllama() {
	let attempts = 0
	const maxAttempts = 30 // 30 seconds with 1 second intervals
	
	while (attempts < maxAttempts) {
		try {
			const result = await window.whistant.checkOllama()
			if (result.success) {
				console.log('✅ Ollama is ready with', result.models?.length || 0, 'models')
				// Display models list with GPU load status
				await displayModelsList(result.models || [])
				// Load and display system info
				await loadSystemInfo()
				// Show enter code screen
				showScreen('screen-enter-code')
				enableLinkCodeInput()
				return true
			}
		} catch (error) {
			console.log('Attempting to connect to Ollama...', attempts + 1)
		}
		
		// Wait 1 second before trying again
		await new Promise(resolve => setTimeout(resolve, 1000))
		attempts++
	}
	
	// Timeout - show error
	document.getElementById('error-message').textContent = 
		'❌ Ollama is not running\n\nPlease start Ollama on localhost:11434 first.\n\nRun: ollama serve'
	showScreen('screen-error')
	return false
}

/**
 * Display list of available Ollama models with GPU loaded status
 */
async function displayModelsList(models) {
	const modelsList = document.getElementById('models-list')
	if (!modelsList) return
	
	if (!models || models.length === 0) {
		modelsList.innerHTML = '<div style="color: #666;">No models available</div>'
		return
	}
	
	// Get list of loaded models from Ollama
	let loadedModels = []
	try {
		const psResult = await window.whistant.checkLoadedModels()
		if (psResult.success) {
			loadedModels = psResult.models || []
		}
	} catch (e) {
		console.warn('Could not fetch loaded models')
	}
	
	// Build the models list HTML
	let html = ''
	models.forEach(model => {
		const modelName = model.name || model
		const isLoaded = loadedModels.includes(modelName)
		const icon = isLoaded ? '🟢' : '⚪'
		const status = isLoaded ? '<span style="color: #4caf50; font-weight: 600;"> (Loaded in GPU)</span>' : ''
		html += `<div style="padding: 4px 0; font-size: 14px;">${icon} ${modelName}${status}</div>`
	})
	
	modelsList.innerHTML = html
	console.log('✅ Models list displayed with', models.length, 'models,', loadedModels.length, 'loaded')
}/**
 * Load and display system information
 */
async function loadSystemInfo() {
	try {
		const sysInfo = await window.whistant.getSystemInfo()
		if (sysInfo.success) {
			document.getElementById('code-os').textContent = sysInfo.os || '-'
			document.getElementById('code-device').textContent = sysInfo.device || '-'
			document.getElementById('code-cpu').textContent = sysInfo.cpu || '-'
			document.getElementById('code-memory').textContent = sysInfo.memory || '-'
			
			// Format graphics info
			let graphicsText = sysInfo.graphics || '-'
			if (sysInfo.graphicsMemory && sysInfo.graphicsMemory !== 'N/A') {
				graphicsText += ` (${sysInfo.graphicsMemory})`
			}
			document.getElementById('code-graphics').textContent = graphicsText
			
			document.getElementById('code-nvidia-driver').textContent = sysInfo.nvidiaDriver || '-'
			document.getElementById('code-cuda').textContent = sysInfo.cuda || '-'
			document.getElementById('code-models').textContent = sysInfo.models?.join(', ') || '-'
			document.getElementById('code-url').textContent = sysInfo.url || '-'
			console.log('✅ System info loaded')
		}
	} catch (error) {
		console.error('Failed to load system info:', error)
	}
}

/**
 * Submit link code from user input
 */
async function submitLinkCode() {
	if (isSubmitting) return
	
	const codeInput = document.getElementById('link-code-input')
	const code = codeInput.value.trim().toUpperCase()
	
	if (!code || code.length !== 6) {
		alert('Please enter a valid 6-character link code')
		return
	}
	
	isSubmitting = true
	const submitBtn = document.getElementById('submit-code-btn')
	submitBtn.disabled = true
	submitBtn.textContent = 'Linking...'

	console.log(`📝 Submitting link code: ${code} (model selection happens on client app)`)

	try {
		// Register server with the link code (models list is sent by server)
		const registerResult = await window.whistant.registerServer({
			linkCode: code,
		})

		if (registerResult.success && registerResult.data.registered) {
			console.log('✅ Server registered successfully with Whistant!')

			// Save registration
			await window.whistant.saveRegistration({
				os: registerResult.data.os || '-',
				device: registerResult.data.device || '-',
				models: registerResult.data.models || [],
				url: registerResult.data.url || '-',
				nvidiaDriver: registerResult.data.nvidiaDriver || '-',
				cudaVersion: registerResult.data.cudaVersion || '-',
				userId: registerResult.data.userId || code,
				serverId: registerResult.data.serverId,
				username: registerResult.data.username,
				registered: true,
				timestamp: new Date().toISOString(),
			})

			// Show success screen
			document.getElementById('success-username').textContent = registerResult.data.username || '-'
			document.getElementById('success-server-id').textContent = registerResult.data.serverId || '-'
			document.getElementById('success-os').textContent = registerResult.data.os || '-'
			document.getElementById('success-device').textContent = registerResult.data.device || '-'
			document.getElementById('success-model').textContent = (registerResult.data.models || []).join(', ') || '-'
			document.getElementById('success-url').textContent = registerResult.data.url || '-'
			document.getElementById('success-nvidia-driver').textContent = registerResult.data.nvidiaDriver || '-'
			document.getElementById('success-cuda-version').textContent = registerResult.data.cudaVersion || '-'
			showScreen('screen-success')
			console.log('✅ Server linked to Whistant!')
		} else {
			throw new Error(registerResult.error || 'Registration failed - server did not confirm')
		}
	} catch (error) {
		console.error('Error:', error.message)
		document.getElementById('error-message').textContent = '❌ ' + error.message
		showScreen('screen-error')
	} finally {
		isSubmitting = false
		submitBtn.disabled = false
		submitBtn.textContent = 'Link Server'
	}
}

/**
 * Check services status (Ollama and Cloudflared)
 */
let statusCheckInterval = null

async function checkServicesStatus() {
	// Check Ollama
	const ollamaResult = await window.whistant.checkOllama()
	const ollamaStatus = document.getElementById('ollama-status')
	if (ollamaResult.success) {
		ollamaStatus.textContent = '✅'
		ollamaStatus.title = 'Ollama is running'
	} else {
		ollamaStatus.textContent = '❌'
		ollamaStatus.title = 'Ollama is not running'
	}
	
	// Update code entry screen status
	const currentScreen = document.querySelector('.screen.active')?.id
	if (currentScreen === 'screen-enter-code') {
		const ollamaCodeStatus = document.getElementById('code-screen-ollama')
		if (ollamaCodeStatus) {
			ollamaCodeStatus.textContent = ollamaResult.success ? '✅ Running' : '❌ Not running'
		}
	}

	// Check Cloudflared
	const cloudflaredResult = await window.whistant.checkCloudflared()
	const cloudflaredStatus = document.getElementById('cloudflared-status')
	if (cloudflaredResult.success) {
		cloudflaredStatus.textContent = '✅'
		cloudflaredStatus.title = `Tunnel: ${cloudflaredResult.url}`
		
		// Update the URL in success screen if displayed (UI only - server update happens in main process)
		const currentScreen = document.querySelector('.screen.active')?.id
		if (currentScreen === 'screen-success') {
			const urlElement = document.getElementById('success-url')
			const currentUrl = urlElement.textContent
			// Only update UI if current URL is localhost or different from tunnel URL
			if (currentUrl.includes('localhost') || currentUrl !== cloudflaredResult.url) {
				urlElement.textContent = cloudflaredResult.url
				console.log(`✅ Updated URL display to: ${cloudflaredResult.url}`)
			}
		}
		
		// Update code entry screen URL
		if (currentScreen === 'screen-enter-code') {
			const urlElement = document.getElementById('code-url')
			if (urlElement) {
				urlElement.textContent = cloudflaredResult.url
			}
		}
	} else {
		cloudflaredStatus.textContent = '⚠️'
		cloudflaredStatus.title = cloudflaredResult.error || 'Tunnel not available'
	}
}

// Start status monitoring on load
function startStatusMonitoring() {
	// Clear any existing interval
	if (statusCheckInterval) clearInterval(statusCheckInterval)
	
	// Check immediately
	checkServicesStatus()
	
	// Then check every 5 seconds
	statusCheckInterval = setInterval(checkServicesStatus, 5000)
}

/**
 * Check Ollama status
 */
async function checkOllamaStatus() {
	const result = await window.whistant.checkOllama()
	if (!result.success) {
		document.getElementById('error-message').textContent = 
			'❌ Ollama is not running\n\nPlease start Ollama on localhost:11434 first.'
		showScreen('screen-error')
		return false
	}
	console.log(`✅ Ollama running with ${result.models?.length || 0} models`)
	return true
}

/**
 * Submit link code to Whistant
 */
async function registerWithCode(code, osInfo, deviceInfo, modelInfo) {
	if (isSubmitting) return

	const linkCode = code.trim().toUpperCase()

	if (!linkCode || linkCode.length !== 6) {
		alert('❌ Please enter a valid 6-character link code')
		return
	}

	isSubmitting = true

	console.log(`📝 Submitting link code: ${linkCode}`)

	try {
		// Register server with the link code
		const registerResult = await window.whistant.registerServer({
			linkCode: linkCode,
		})

		if (registerResult.success) {
			console.log('✅ Server registered successfully!')

			// Save registration
			await window.whistant.saveRegistration({
				os: registerResult.data.os || osInfo || '-',
				device: registerResult.data.device || deviceInfo || '-',
				model: registerResult.data.model || modelInfo || '-',
				url: registerResult.data.url || '-',
				nvidiaDriver: registerResult.data.nvidiaDriver || '-',
				cudaVersion: registerResult.data.cudaVersion || '-',
				userId: registerResult.data.userId,
				timestamp: new Date().toISOString(),
			})

			// Show success with populated data
			document.getElementById('success-os').textContent = registerResult.data.os || '-'
			document.getElementById('success-device').textContent = registerResult.data.device || '-'
			document.getElementById('success-model').textContent = registerResult.data.model || '-'
			document.getElementById('success-url').textContent = registerResult.data.url || '-'
			document.getElementById('success-nvidia-driver').textContent = registerResult.data.nvidiaDriver || '-'
			document.getElementById('success-cuda-version').textContent = registerResult.data.cudaVersion || '-'
			showScreen('screen-success')
			console.log('✅ Server linked to user!')
		} else {
			throw new Error(registerResult.error)
		}
	} catch (error) {
		console.error('Error:', error.message)
		document.getElementById('error-message').textContent = '❌ ' + error.message
		showScreen('screen-error')
	} finally {
		isSubmitting = false
	}
}

/**
 * Show specific screen
 */
function showScreen(screenId) {
	document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
	document.getElementById(screenId).classList.add('active')
	
	// Reset input field when showing enter-code screen
	if (screenId === 'screen-enter-code') {
		const screen = document.getElementById('screen-enter-code')
		if (screen) {
			screen.style.pointerEvents = 'auto'
			screen.style.opacity = '1'
		}
		enableLinkCodeInput()
	}
}

/**
 * Show error
 */
function showError(message) {
	document.getElementById('error-message').textContent = message
	showScreen('screen-error')
}

/**
 * Reset app
 */
async function resetApp() {
	isSubmitting = false
	// Clear registration and start fresh
	const currentScreen = document.querySelector('.screen.active')?.id
	if (currentScreen === 'screen-success') {
		// If resetting from success screen, just close or do nothing
		// Don't restart the process since we're already registered
		console.log('App already registered, staying on success screen')
		return
	}
	showScreen('screen-check-ollama')
	await waitForOllama()
}

/**
 * Unlink server - clear registration and start over
 */
async function unlinkServer() {
	// Clear registration file
	await window.whistant.saveRegistration(null)
	
	// Reset submission state
	isSubmitting = false
	
	// Restart the app flow
	showScreen('screen-check-ollama')
	await waitForOllama()
	enableLinkCodeInput()
}
