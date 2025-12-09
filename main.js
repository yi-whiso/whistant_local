/**
 * Whistant Desktop App - Main Process
 * Device linking via code (like YouTube TV)
 */

// Load environment variables with fallbacks for AppImage/runtime
const dotenv = require('dotenv')
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const axios = require('axios')
const { execSync, spawn } = require('child_process')
const { log } = require('console')

function loadEnv() {
	// 1) Try current working directory
	const cwdEnv = path.join(process.cwd(), '.env')
	if (fs.existsSync(cwdEnv)) {
		dotenv.config({ path: cwdEnv })
		return
	}
	// 2) Try user home config: ~/.whistant_local/.env
	const homeEnvDir = path.join(os.homedir(), '.whistant_local')
	const homeEnv = path.join(homeEnvDir, '.env')
	if (fs.existsSync(homeEnv)) {
		dotenv.config({ path: homeEnv })
		return
	}
	// 3) Try Electron userData directory
	try {
		const userDataDir = app ? app.getPath('userData') : null
		if (userDataDir) {
			const userDataEnv = path.join(userDataDir, '.env')
			if (fs.existsSync(userDataEnv)) {
				dotenv.config({ path: userDataEnv })
				return
			}
		}
	} catch {}
	// If none found, proceed with defaults below
}
loadEnv()

// Load built-in defaults and then overlay environment variables
let DEFAULTS = { WHISTANT_SERVER_URL: 'https://whisolla.com:2087', OLLAMA_SERVER_URL: 'http://localhost:11434' }
try {
	const defaultsPath = path.join(__dirname, 'config', 'defaults.json')
	if (fs.existsSync(defaultsPath)) {
		const raw = fs.readFileSync(defaultsPath, 'utf-8')
		const parsed = JSON.parse(raw)
		DEFAULTS = { ...DEFAULTS, ...parsed }
	}
} catch (e) {
	console.warn('⚠️  Failed to load defaults.json, using hardcoded defaults')
}

// Environment variables (override defaults if provided)
const WHISTANT_SERVER_URL = process.env.WHISTANT_SERVER_URL || DEFAULTS.WHISTANT_SERVER_URL
const OLLAMA_SERVER_URL = process.env.OLLAMA_SERVER_URL || DEFAULTS.OLLAMA_SERVER_URL

/**
 * Get NVIDIA driver and CUDA version
 */
function getNvidiaInfo() {
	try {
		// Get GPU info
		const output = execSync('nvidia-smi --query-gpu=driver_version,name,memory.total --format=csv,noheader', {
			encoding: 'utf-8',
			timeout: 5000,
		}).trim()
		
		const [driverVersion, gpuName, gpuMemory] = output.split(',').map(s => s.trim())
		
		// Get CUDA version from nvidia-smi
		let cudaVersion = 'Not available'
		try {
			const cudaOutput = execSync('nvidia-smi', {
				encoding: 'utf-8',
				timeout: 5000,
			})
			// Extract CUDA Version from the header line like "CUDA Version: 12.4"
			const cudaMatch = cudaOutput.match(/CUDA Version:\s*(\d+\.\d+)/)
			if (cudaMatch) {
				cudaVersion = cudaMatch[1]
			}
		} catch (e) {
			console.warn('⚠️  Could not determine CUDA version from nvidia-smi')
		}
		
		return {
			driver: driverVersion || 'Not available',
			cuda: cudaVersion,
			name: gpuName || 'Not available',
			memory: gpuMemory || 'Not available',
			available: true,
		}
	} catch (error) {
		return {
			driver: 'Not available',
			cuda: 'Not available',
			name: 'No NVIDIA GPU detected',
			memory: 'N/A',
			available: false,
		}
	}
}

/**
 * Collect all system information
 */
function collectSystemInfo() {
	const hostname = os.hostname()
	const cpuInfo = os.cpus()
	const totalMemory = os.totalmem()
	const nvidiaInfo = getNvidiaInfo()
	const platform = os.platform()
	const release = os.release()
	const arch = os.arch()

	const deviceId = hostname
	const osInfo = {
		platform: platform,
		release: release,
		arch: arch,
		uptime: os.uptime(),
	}

	const hardware = {
		cpu: `${cpuInfo.length}x ${cpuInfo[0].model}`,
		gpu: `${nvidiaInfo.name} (${nvidiaInfo.memory})`,
		memory: `${(totalMemory / (1024 ** 3)).toFixed(2)} GB`,
		nvidiaDriver: nvidiaInfo.driver,
		cudaVersion: nvidiaInfo.cuda,
	}

	return {
		deviceId,
		osInfo,
		hardware,
		nvidiaInfo,
	}
}

/**
 * Fetch available models from Ollama
 */
async function fetchAvailableModels() {
	try {
		const response = await axios.get(`${OLLAMA_SERVER_URL}/api/tags`, { timeout: 5000 })
		return response.data.models ? response.data.models.map(m => m.name) : []
	} catch (e) {
		console.warn('⚠️  Could not fetch models from Ollama')
		return []
	}
}

// Keep a global reference of the window object
let mainWindow
let cloudflaredProcess = null
let detectedTunnelUrl = null  // Store the detected tunnel URL

/**
 * Get cloudflared tunnel URL from quick tunnel
 */
async function getCloudflaredUrl() {
	try {
		// cloudflared runs a local API on port 49312 by default
		// Try to connect and get metrics
		const response = await axios.get('http://localhost:49312/metrics', {
			timeout: 2000,
		})
		
		const lines = response.data.split('\n')
		for (const line of lines) {
			// Look for tunnel URL in metrics output
			if (line.includes('https://') && line.includes('trycloudflare.com')) {
				const match = line.match(/(https:\/\/[a-z0-9\-]+\.trycloudflare\.com)/)
				if (match) {
					console.log('✅ Found active tunnel:', match[1])
					return match[1]
				}
			}
		}
	} catch (e) {
		console.warn('⚠️  Could not connect to cloudflared local API to get tunnel URL')
	}

	return null
}

/**
 * Check if cloudflared tunnel is running
 */
async function checkCloudflaredTunnel() {
	try {
		const url = await getCloudflaredUrl()
		if (url) {
			console.log('📡 Active cloudflared tunnel detected:', url)
			return url
		}
	} catch (e) {
		console.warn('⚠️  Error checking cloudflared tunnel:', e.message)
	}

	console.warn('⚠️  No active cloudflared tunnel detected')
	console.warn('📋 To create a tunnel, open a terminal and run:')
	console.warn(`   cloudflared tunnel --url ${OLLAMA_SERVER_URL}`)
	return null
}

/**
 * Start cloudflared quick tunnel to localhost:11434
 */
async function startCloudflaredTunnel() {
	try {
		// Check if cloudflared is installed
		try {
			execSync('cloudflared --version', { 
				encoding: 'utf-8',
				stdio: 'pipe',
			})
			console.log('✅ cloudflared is installed')
		} catch (e) {
			const isWindows = os.platform() === 'win32'
			const installCmd = isWindows ? 'winget install --id Cloudflare.cloudflared' : 'sudo apt install cloudflared'
			console.warn(`⚠️  cloudflared not found. Install with: ${installCmd}`)
			return null
		}

		console.log('📡 Starting cloudflared tunnel in background...')

		// Start cloudflared tunnel
		// cloudflared tunnel --url http://localhost:11434
		cloudflaredProcess = spawn('cloudflared', [
			'tunnel',
			'--url', OLLAMA_SERVER_URL
		], {
			detached: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		})

		let tunnelUrl = null
		let found = false

		// Listen to stdout for the tunnel URL
		cloudflaredProcess.stdout.on('data', (data) => {
			const output = data.toString()
			console.log('[cloudflared stdout]', output)
			
			// Look for URL in output
			const match = output.match(/(https:\/\/[a-z0-9\-]+\.trycloudflare\.com)/)
			if (match && !found) {
				tunnelUrl = match[1]
				found = true
				console.log('✅ Tunnel URL detected:', tunnelUrl)
			}
		})

		// Also listen to stderr (cloudflared sometimes outputs to stderr)
		cloudflaredProcess.stderr.on('data', (data) => {
			const output = data.toString()
			console.log('[cloudflared stderr]', output)
			
			// Look for URL in stderr too
			const match = output.match(/(https:\/\/[a-z0-9\-]+\.trycloudflare\.com)/)
			if (match && !found) {
				tunnelUrl = match[1]
				found = true
				console.log('✅ Tunnel URL detected:', tunnelUrl)
			}
		})

		cloudflaredProcess.on('error', (err) => {
			console.error('Failed to start cloudflared:', err.message)
		})

		cloudflaredProcess.on('close', (code) => {
			console.log('Cloudflared exited with code:', code)
		})

		// Wait for URL to be detected (up to 15 seconds)
		let attempts = 0
		while (!found && attempts < 30) {
			await new Promise(r => setTimeout(r, 500))
			attempts++
		}

		if (tunnelUrl) {
			detectedTunnelUrl = tunnelUrl  // Store globally
			console.log('🎉 Tunnel established:', tunnelUrl)
			
			// Update URL on Whistant server if already registered
			await updateServerUrlIfRegistered(tunnelUrl)
			
			return tunnelUrl
		} else {
			console.warn('⚠️  Cloudflared started but URL not detected after 15 seconds')
			console.warn('   The tunnel may still be connecting...')
			return null
		}
	} catch (error) {
		console.error('Cloudflared startup error:', error.message)
		return null
	}
}

/**
 * Update server URL on Whistant if already registered
 */
async function updateServerUrlIfRegistered(newUrl) {
	try {
		const dataPath = path.join(app.getPath('userData'), 'registration.json')
		if (!fs.existsSync(dataPath)) {
			console.log('⏭️  No registration file found, skipping URL update')
			return // Not registered yet
		}
		
		const registration = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
		if (!registration || !registration.registered || !registration.serverId) {
			console.log('⏭️  Server not registered yet, skipping URL update')
			return // Not registered yet
		}
		
		console.log(`🔍 Current URL: ${registration.url}`)
		console.log(`🔍 New URL: ${newUrl}`)
		
		// Check if URL actually changed
		if (registration.url === newUrl) {
			console.log('⏭️  URL unchanged, skipping update')
			return // URL hasn't changed
		}
		
		console.log(`📡 Updating server URL on Whistant: ${registration.serverId}`)
		console.log(`   Old: ${registration.url}`)
		console.log(`   New: ${newUrl}`)
		
		// Collect system info for the update
		const sysInfo = collectSystemInfo()
		
		// Get current available models
		const availableModels = await fetchAvailableModels()
		
		const payload = {
			link_code: registration.serverId.toLowerCase(),
			deviceId: sysInfo.deviceId,
			osInfo: JSON.stringify(sysInfo.osInfo),
			hardware: JSON.stringify(sysInfo.hardware),
			url: newUrl,
			models: availableModels,
		}

		const response = await axios.post(
			WHISTANT_SERVER_URL + '/server/register',
			payload,
			{ headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
		)

		console.log('✅ Server URL updated on Whistant backend')
		console.log('Response:', JSON.stringify(response.data, null, 2))
		
		// Update local registration file
		registration.url = newUrl
		fs.writeFileSync(dataPath, JSON.stringify(registration, null, 2))
		
	} catch (error) {
		console.error('❌ Failed to update server URL on Whistant:', error.message)
		if (error.response?.data) {
			console.error('Server response:', JSON.stringify(error.response.data, null, 2))
		}
	}
}

/**
 * Monitor services every 30 minutes
 */
async function monitorServices() {
	console.log('🔍 Service monitoring check...')
	
	try {
		// Check if Ollama is running
		const ollamaCheck = await axios.get(`${OLLAMA_SERVER_URL}/api/tags`, { timeout: 5000 }).catch(() => ({ status: false }))
		if (ollamaCheck.status !== 200) {
			console.warn('⚠️  Ollama appears to be down, but not restarting (manual service)')
		} else {
			console.log('✅ Ollama is running')
		}
	} catch (e) {
		console.warn('⚠️  Ollama check failed:', e.message)
	}
	
	try {
		// Check if tunnel is still active
		const tunnelUrl = await getCloudflaredUrl()
		if (tunnelUrl) {
			detectedTunnelUrl = tunnelUrl
			console.log('✅ Tunnel is active:', tunnelUrl)
			// Check if URL changed and update if needed
			await updateServerUrlIfRegistered(tunnelUrl)
		} else {
			console.warn('⚠️  Tunnel is down, restarting cloudflared...')
			// Kill old process if still running
			if (cloudflaredProcess) {
				try {
					cloudflaredProcess.kill()
				} catch (e) {}
			}
			// Restart tunnel (URL update will be sent automatically in startCloudflaredTunnel)
			const newTunnelUrl = await startCloudflaredTunnel()
			if (newTunnelUrl) {
				console.log('✅ Tunnel restarted:', newTunnelUrl)
			} else {
				console.error('❌ Failed to restart tunnel')
			}
		}
	} catch (e) {
		console.error('⚠️  Tunnel monitoring failed:', e.message)
	}
}

/**
 * Create the browser window
 */
function createWindow() {
	const iconPath = path.join(__dirname, 'ui', 'appicon.png')
	const windowOptions = {
		width: 600,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			enableRemoteModule: false,
			nodeIntegration: false,
		},
	}
	
	// Set icon if file exists (Linux requires icon to be set)
	if (fs.existsSync(iconPath)) {
		windowOptions.icon = iconPath
	}
	
	mainWindow = new BrowserWindow(windowOptions)

	mainWindow.loadFile('ui/index.html')
	
	// Hide the menu bar
	mainWindow.setMenuBarVisibility(false)

	// Open DevTools in development
	if (process.argv.includes('--dev')) {
		mainWindow.webContents.openDevTools()
	}

	mainWindow.on('closed', () => {
		mainWindow = null
	})
}

/**
 * App event handlers
 */
app.on('ready', async () => {
	createWindow()
	// Start cloudflared tunnel in background
	const tunnelUrl = await startCloudflaredTunnel()
	if (tunnelUrl) {
		console.log('📡 Tunnel is ready for use:', tunnelUrl)
	} else {
		console.warn('⚠️  No tunnel available, will use localhost')
	}
	
	// Start service monitoring every 30 minutes (1800000 ms)
	setInterval(monitorServices, 1800000)
	console.log('🔍 Service monitoring started (every 30 minutes)')
})

app.on('window-all-closed', () => {
	// Clean up cloudflared process if we started it
	if (cloudflaredProcess) {
		try {
			console.log('🛑 Stopping cloudflared tunnel...')
			cloudflaredProcess.kill()
			cloudflaredProcess = null
		} catch (e) {
			console.error('Error stopping cloudflared:', e.message)
		}
	}
	
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

app.on('activate', () => {
	if (mainWindow === null) {
		createWindow()
	}
})

/**
 * IPC Handlers - Renderer to Main communication
 */

// Poll for linking completion
ipcMain.handle('poll-linking-status', async (event, code) => {
	try {
		const linkingPath = path.join(app.getPath('userData'), `linking-${code}.json`)

		// Check if linking file exists (would be created by Whisolla server)
		if (fs.existsSync(linkingPath)) {
			const data = JSON.parse(fs.readFileSync(linkingPath, 'utf-8'))
			fs.unlinkSync(linkingPath) // Delete after reading
			return {
				success: true,
				linked: true,
				data,
			}
		}

		return { success: true, linked: false }
	} catch (error) {
		return { success: false, error: error.message }
	}
})

// Register server with Whistant server (using link_code)
ipcMain.handle('register-server', async (event, { linkCode }) => {
	try {
		// Collect all system information
		const systemInfo = collectSystemInfo()
		const { deviceId, osInfo, hardware, nvidiaInfo } = systemInfo

		// Get tunnel URL - wait for cloudflared if not available yet
		let publicUrl = detectedTunnelUrl
		
		if (!publicUrl) {
			console.log('⏳ Waiting for cloudflared tunnel URL...')
			let attempts = 0
			const maxAttempts = 60 // 60 seconds (increased timeout)
			
			while (attempts < maxAttempts && !publicUrl) {
				try {
					const freshUrl = await getCloudflaredUrl()
					if (freshUrl) {
						publicUrl = freshUrl
						detectedTunnelUrl = freshUrl  // Cache it
						console.log(`✅ Detected cloudflared URL: ${publicUrl}`)
						break
					}
				} catch (e) {
					// Continue waiting
					console.log(`⏳ Attempt ${attempts + 1}/${maxAttempts} - waiting for tunnel...`)
				}
				
				attempts++
				if (attempts < maxAttempts) {
					await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second
				}
			}
			
			// If we still don't have a URL after waiting, fall back to localhost
			if (!publicUrl) {
				console.warn('⚠️  Could not detect cloudflared URL after 60 seconds')
				console.warn('⚠️  Using localhost as fallback - server will only be accessible locally')
				publicUrl = OLLAMA_SERVER_URL
			}
		} else {
			console.log(`📡 Using cached tunnel URL: ${publicUrl}`)
		}

		// Get all available models from Ollama
		const availableModels = await fetchAvailableModels()
		console.log(`📦 Found ${availableModels.length} models:`, availableModels.join(', '))
		
		// Log what we collected
		console.log('📝 System Information Collected:')
		console.log(`   Device ID: ${deviceId}`)
		console.log(`   OS: ${osInfo.platform} ${osInfo.release} (${osInfo.arch})`)
		console.log(`   Hardware: ${JSON.stringify(hardware)}`)
		console.log(`   URL: ${publicUrl}`)
		console.log(`   Models: ${availableModels.join(', ')}`)

		// Try to register with remote server using link code
		try {
			const payload = {
				link_code: linkCode.toLowerCase(),
				deviceId: deviceId,
				osInfo: JSON.stringify(osInfo),
				hardware: JSON.stringify(hardware),
				url: publicUrl,
				models: availableModels,
			}

			console.log('Attempting to register with remote server...')
			console.log('Sending payload:', JSON.stringify(payload, null, 2))

			const response = await axios.post(
				`${WHISTANT_SERVER_URL}/server/register`,
				payload,
				{ headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
			)

			console.log('✅ Remote server registration successful!')
			console.log('Response:', JSON.stringify(response.data, null, 2))

			// Check if server confirmed registration (check for success code or userId)
			if (response.data.code !== 'SERVER_REGISTER_SUCCESS' && !response.data.userId) {
				throw new Error('Server did not confirm registration')
			}

			return {
				success: true,
				data: {
					registered: true,
					userId: response.data.userId,
					serverId: response.data.serverId,
					username: response.data.username,
					url: publicUrl,
					os: `${osInfo.platform} ${osInfo.release}`,
					device: deviceId,
					models: availableModels,
					nvidiaDriver: nvidiaInfo.driver,
					cudaVersion: nvidiaInfo.cuda,
				},
			}
		} catch (remoteError) {
			console.error('❌ Remote registration failed')
			console.error('Remote error:', remoteError.message)
			if (remoteError.response?.data) {
				console.error('Server response:', JSON.stringify(remoteError.response.data, null, 2))
			}
			
			// Return error - don't fake success
			return {
				success: false,
				error: remoteError.response?.data?.error || remoteError.message || 'Failed to register with Whistant server',
			}
		}
	} catch (error) {
		console.error('❌ Registration error:', error.message)
		if (error.response?.data) {
			console.error('Server error response:', JSON.stringify(error.response.data, null, 2))
		}
		return {
			success: false,
			error: error.message || 'Failed to collect system information',
		}
	}
})

// Save registration data
ipcMain.handle('save-registration', async (event, data) => {
	try {
		const dataPath = path.join(app.getPath('userData'), 'registration.json')
		if (data === null) {
			// Delete registration file
			if (fs.existsSync(dataPath)) {
				fs.unlinkSync(dataPath)
			}
		} else {
			fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
		}
		return { success: true }
	} catch (error) {
		return { success: false, error: error.message }
	}
})

// Load registration data
ipcMain.handle('load-registration', async (event) => {
	try {
		const dataPath = path.join(app.getPath('userData'), 'registration.json')
		if (fs.existsSync(dataPath)) {
			const data = fs.readFileSync(dataPath, 'utf-8')
			return JSON.parse(data)
		}
		return null
	} catch (error) {
		return null
	}
})

// Open browser
ipcMain.handle('open-browser', async (event, url) => {
	const { shell } = require('electron')
	await shell.openExternal(url)
	return { success: true }
})

// Check Ollama connection
ipcMain.handle('check-ollama', async (event) => {
	try {
		const axios = require('axios')
		const response = await axios.get(`${OLLAMA_SERVER_URL}/api/tags`, {
			timeout: 5000,
		})
		return { success: true, models: response.data.models || [] }
	} catch (error) {
		return { success: false, error: `Ollama not running on ${OLLAMA_SERVER_URL}` }
	}
})

// Check loaded models (models currently in GPU memory)
ipcMain.handle('check-loaded-models', async (event) => {
	try {
		const axios = require('axios')
		const response = await axios.get(`${OLLAMA_SERVER_URL}/api/ps`, {
			timeout: 5000,
		})
		// Extract model names from running models
		const loadedModels = (response.data.models || []).map(m => m.name)
		return { success: true, models: loadedModels }
	} catch (error) {
		return { success: false, error: 'Could not fetch loaded models', models: [] }
	}
})

// Check Cloudflared tunnel
ipcMain.handle('check-cloudflared', async (event) => {
	try {
		// First check if we have a cached tunnel URL
		if (detectedTunnelUrl) {
			return { success: true, url: detectedTunnelUrl }
		}
		
		// If not cached, try to detect from metrics
		const url = await getCloudflaredUrl()
		if (url) {
			detectedTunnelUrl = url  // Cache it
			return { success: true, url: url }
		}
		return { success: false, error: 'Tunnel starting up...' }
	} catch (error) {
		return { success: false, error: 'Cloudflared tunnel not available' }
	}
})

// Get current tunnel URL (for updating registration)
ipcMain.handle('get-tunnel-url', async (event) => {
	try {
		// Try to get fresh URL from cloudflared
		const url = await getCloudflaredUrl()
		if (url) {
			detectedTunnelUrl = url  // Update cache
			return { success: true, url: url }
		}
		// Fall back to cached URL
		if (detectedTunnelUrl) {
			return { success: true, url: detectedTunnelUrl }
		}
		return { success: false, url: OLLAMA_SERVER_URL }
	} catch (error) {
		return { success: false, url: OLLAMA_SERVER_URL }
	}
})

// Get detailed system information
ipcMain.handle('get-system-info', async (event) => {
	try {
		const hostname = os.hostname()
		const cpuInfo = os.cpus()
		const totalMemory = os.totalmem()
		const nvidiaInfo = getNvidiaInfo()
		const platform = os.platform()
		const release = os.release()
		const arch = os.arch()
		
		// Get Ollama models
		let models = []
		try {
			const response = await axios.get(`${OLLAMA_SERVER_URL}/api/tags`, { timeout: 5000 })
			models = response.data.models ? response.data.models.map(m => m.name) : []
		} catch (e) {
			models = ['Unable to fetch models']
		}
		
		// Get tunnel URL
		let tunnelUrl = detectedTunnelUrl || OLLAMA_SERVER_URL
		try {
			const url = await getCloudflaredUrl()
			if (url) {
				tunnelUrl = url
				detectedTunnelUrl = url
			}
		} catch (e) {}
		
		return {
			success: true,
			os: `${platform} ${release} (${arch})`,
			device: hostname,
			cpu: `${cpuInfo.length}x ${cpuInfo[0].model}`,
			gpu: `${nvidiaInfo.name} (${nvidiaInfo.memory})`,
			memory: `${(totalMemory / (1024 ** 3)).toFixed(2)} GB`,
			nvidiaDriver: nvidiaInfo.driver,
			cuda: nvidiaInfo.cuda,
			models: models,
			url: tunnelUrl,
		}
	} catch (error) {
		return { success: false, error: error.message }
	}
})

// Bring the main window to focus (helps when input seems unresponsive until minimize/restore)
ipcMain.handle('focus-window', async () => {
	try {
		if (mainWindow) {
			if (mainWindow.isMinimized()) {
				mainWindow.restore()
			}
			mainWindow.focus()
			mainWindow.webContents.focus()
		}
		return { success: true }
	} catch (error) {
		console.error('focus-window error:', error.message)
		return { success: false, error: error.message }
	}
})