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
 * Get AMD GPU information
 */
function getAmdInfo() {
	try {
		const platform = os.platform()
		
		if (platform === 'win32') {
			// Windows: Use wmic to query AMD GPU
			const output = execSync('wmic path win32_VideoController get name,AdapterRAM /format:csv', {
				encoding: 'utf-8',
				timeout: 5000,
			}).trim()
			
			const lines = output.split('\n').filter(line => line.trim())
			for (const line of lines) {
				const parts = line.split(',')
				if (parts.length >= 3 && parts[2] && (parts[2].includes('AMD') || parts[2].includes('Radeon'))) {
					const name = parts[2].trim()
					const memoryBytes = parseInt(parts[1]) || 0
					const memory = memoryBytes > 0 ? `${(memoryBytes / (1024 ** 3)).toFixed(2)} GB` : 'Not available'
					
					return {
						name: name,
						memory: memory,
						available: true,
					}
				}
			}
		} else if (platform === 'linux') {
			// Linux: Use lspci to find AMD GPU
			try {
				const output = execSync('lspci | grep -i vga', {
					encoding: 'utf-8',
					timeout: 5000,
				}).trim()
				
				if (output.includes('AMD') || output.includes('Radeon')) {
					const match = output.match(/: (.+)/)
					const name = match ? match[1].trim() : 'AMD GPU detected'
					
					// Try to get memory info from rocm-smi if available
					let memory = 'Not available'
					try {
						const rocmOutput = execSync('rocm-smi --showmeminfo vram --csv', {
							encoding: 'utf-8',
							timeout: 5000,
						})
						const memMatch = rocmOutput.match(/(\d+)\s*MB/)
						if (memMatch) {
							memory = `${(parseInt(memMatch[1]) / 1024).toFixed(2)} GB`
						}
					} catch {}
					
					return {
						name: name,
						memory: memory,
						available: true,
					}
				}
			} catch {}
		}
		
		return {
			name: 'No AMD GPU detected',
			memory: 'N/A',
			available: false,
		}
	} catch (error) {
		return {
			name: 'No AMD GPU detected',
			memory: 'N/A',
			available: false,
		}
	}
}

/**
 * Get Mac GPU information (Metal)
 */
function getMacInfo() {
	try {
		const platform = os.platform()
		
		if (platform === 'darwin') {
			// macOS: Use system_profiler to query GPU
			const output = execSync('system_profiler SPDisplaysDataType', {
				encoding: 'utf-8',
				timeout: 5000,
			}).trim()
			
			// Parse for GPU name
			const nameMatch = output.match(/Chipset Model:\s*(.+)/)
			const name = nameMatch ? nameMatch[1].trim() : 'Mac GPU detected'
			
			// Parse for VRAM
			let memory = 'Shared'
			const vramMatch = output.match(/VRAM \(Total\):\s*(.+)/)
			if (vramMatch) {
				memory = vramMatch[1].trim()
			} else {
				// Check for unified memory on Apple Silicon
				const memMatch = output.match(/Metal:\s*Supported/)
				if (memMatch) {
					memory = 'Unified Memory (Metal supported)'
				}
			}
			
			return {
				name: name,
				memory: memory,
				available: true,
				metal: true,
			}
		}
		
		return {
			name: 'Not a Mac',
			memory: 'N/A',
			available: false,
			metal: false,
		}
	} catch (error) {
		return {
			name: 'No Mac GPU detected',
			memory: 'N/A',
			available: false,
			metal: false,
		}
	}
}

/**
 * Check if Ollama is running
 */
function isOllamaRunning() {
	try {
		const platform = os.platform()
		let command = ''
		
		if (platform === 'win32') {
			// Windows: Check if ollama.exe process is running
			command = 'tasklist | find /i "ollama"'
		} else {
			// macOS/Linux: Check for ollama processes
			command = 'ps aux | grep -i ollama | grep -v grep'
		}
		
		try {
			const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' })
			return output.trim().length > 0
		} catch (e) {
			return false
		}
	} catch (e) {
		console.warn('Error checking if Ollama is running:', e.message)
		return false
	}
}

/**
 * Stop Ollama gracefully
 */
function stopOllama() {
	try {
		const platform = os.platform()
		
		if (platform === 'win32') {
			console.log('🛑 Stopping Ollama on Windows...')
			execSync('taskkill /IM ollama.exe /F', { stdio: 'pipe' })
		} else {
			console.log('🛑 Stopping Ollama on Unix...')
			// Kill ollama serve process gracefully, then force if needed
			try {
				execSync('pkill -f "ollama serve"', { stdio: 'pipe' })
			} catch (e) {
				// pkill failed, try killall
				try {
					execSync('killall ollama', { stdio: 'pipe' })
				} catch (e2) {
					console.warn('⚠️  Could not kill Ollama process')
				}
			}
		}
		
		// Wait a bit for graceful shutdown
		console.log('⏳ Waiting for Ollama to stop...')
		execSync('sleep 2', { stdio: 'pipe' })
		
		console.log('✅ Ollama stopped')
		return true
	} catch (error) {
		console.warn('⚠️  Error stopping Ollama:', error.message)
		return false
	}
}

/**
 * Find ollama executable path
 */
function findOllamaExecutable() {
	const platform = os.platform()
	const home = os.homedir()
	
	// Common installation paths for ollama
	const searchPaths = platform === 'win32'
		? [
			'ollama',
			path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
			'C:\\Program Files\\Ollama\\ollama.exe',
		]
		: platform === 'darwin'
		? [
			'ollama',
			'/usr/local/bin/ollama',
			'/opt/homebrew/bin/ollama',
			path.join(home, '.ollama', 'bin', 'ollama'),
		]
		: [
			'ollama',
			'/usr/local/bin/ollama',
			'/usr/bin/ollama',
			path.join(home, '.ollama', 'bin', 'ollama'),
		]
	
	// Try to find ollama
	for (const ollamaPath of searchPaths) {
		if (ollamaPath === 'ollama') {
			try {
				// Test if ollama is in PATH
				const result = execSync('which ollama 2>/dev/null || where ollama 2>nul', {
					encoding: 'utf-8',
					stdio: 'pipe',
					shell: true,
				}).trim()
				if (result) {
					console.log(`✅ Found ollama in PATH: ${result}`)
					return result
				}
			} catch (e) {
				// Not in PATH
			}
		} else if (fs.existsSync(ollamaPath)) {
			console.log(`✅ Found ollama at: ${ollamaPath}`)
			return ollamaPath
		}
	}
	
	console.warn('⚠️  Could not find ollama executable in common paths')
	return 'ollama' // Fallback to hoping it's in PATH
}

/**
 * Start Ollama with OLLAMA_HOST=0.0.0.0:11434
 */
function startOllamaWithPublicHost() {
	try {
		const platform = os.platform()
		console.log('🚀 Starting Ollama with public host binding (0.0.0.0:11434)...')
		
		// Find ollama executable
		const ollamaPath = findOllamaExecutable()
		console.log(`Using ollama at: ${ollamaPath}`)
		
		// Create environment with OLLAMA_HOST set
		const env = {
			...process.env,
			OLLAMA_HOST: '0.0.0.0:11434'
		}
		
		if (platform === 'win32') {
			// Windows: Start ollama serve in background
			console.log('Starting Ollama serve on Windows...')
			spawn(ollamaPath, ['serve'], {
				detached: true,
				stdio: 'ignore',
				env: env,
				windowsHide: true,
			}).unref()
		} else {
			// macOS/Linux: Start ollama serve in background with nohup
			const logPath = path.join(os.homedir(), '.whistant_local', 'ollama.log')
			const logDir = path.dirname(logPath)
			if (!fs.existsSync(logDir)) {
				fs.mkdirSync(logDir, { recursive: true })
			}
			
			const command = `OLLAMA_HOST=0.0.0.0:11434 nohup "${ollamaPath}" serve > "${logPath}" 2>&1 &`
			console.log(`📝 Ollama logs will be written to: ${logPath}`)
			execSync(command, {
				env: env,
				shell: true,
				stdio: 'pipe',
			})

			
		}
		
		console.log('📡 Ollama starting with OLLAMA_HOST=0.0.0.0:11434')
		return true
	} catch (error) {
		console.error('❌ Error starting Ollama:', error.message)
		console.error('Stack trace:', error.stack)
		return false
	}
}

/**
 * Configure Ollama to accept remote connections
 * Stops running Ollama instance and restarts with proper host binding
 */
async function configureOllamaForRemote() {
	try {
		console.log('🔧 Configuring Ollama for remote access...')
		
		const isRunning = isOllamaRunning()
		
		if (isRunning) {
			console.log('Found running Ollama instance, stopping it...')
			const stopped = stopOllama()
			if (!stopped) {
				console.warn('⚠️  Could not stop existing Ollama, attempting to restart anyway...')
			}
		} else {
			console.log('ℹ️  Ollama is not currently running')
		}
		
		// Wait a moment before restarting
		await new Promise(resolve => setTimeout(resolve, 1000))
		
		// Start Ollama with proper host binding
		const started = startOllamaWithPublicHost()
		
		if (started) {
			// Wait for Ollama to be ready
			console.log('⏳ Waiting for Ollama to start (up to 30 seconds)...')
			
			let attempts = 0
			const maxAttempts = 30
			
			while (attempts < maxAttempts) {
				try {
					const response = await axios.get(`${OLLAMA_SERVER_URL}/api/tags`, { timeout: 2000 })
					if (response.status === 200) {
						console.log('✅ Ollama is ready and accessible from all IPs (0.0.0.0:11434)')
						return { success: true }
					}
				} catch (e) {
					// Still starting
					attempts++
					await new Promise(resolve => setTimeout(resolve, 1000))
				}
			}
			
			console.warn('⚠️  Ollama started but not responding yet (may take a moment)')
			return { success: true, message: 'Ollama started but still initializing' }
		} else {
			return { success: false, error: 'Failed to start Ollama' }
		}
	} catch (error) {
		console.error('Configuration error:', error.message)
		return { success: false, error: error.message }
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
	const amdInfo = getAmdInfo()
	const macInfo = getMacInfo()
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

	// Determine which GPU to use for hardware info
	let gpuInfo = nvidiaInfo
	let gpuType = 'nvidia'
	
	if (!nvidiaInfo.available && amdInfo.available) {
		gpuInfo = amdInfo
		gpuType = 'amd'
	} else if (!nvidiaInfo.available && !amdInfo.available && macInfo.available) {
		gpuInfo = macInfo
		gpuType = 'mac'
	}

	const hardware = {
		cpu: `${cpuInfo.length}x ${cpuInfo[0].model}`,
		gpu: `${gpuInfo.name} (${gpuInfo.memory})`,
		memory: `${(totalMemory / (1024 ** 3)).toFixed(2)} GB`,
		nvidiaDriver: nvidiaInfo.driver,
		cudaVersion: nvidiaInfo.cuda,
	}

	return {
		deviceId,
		osInfo,
		hardware,
		nvidiaInfo,
		amdInfo,
		macInfo,
		gpuType,
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
 * Get cloudflared executable path
 * Checks bundled binary first, then falls back to system installation
 */
function getCloudflaredPath() {
	const platform = os.platform()
	const arch = os.arch()
	
	// Determine platform-specific directory name
	let platformDir = null
	if (platform === 'darwin') {
		platformDir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
	} else if (platform === 'linux') {
		platformDir = 'linux-x64'
	} else if (platform === 'win32') {
		platformDir = 'win32-x64'
	}
	
	if (platformDir) {
		// Check for bundled binary in development or production
		const exeName = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
		
		// Try production path FIRST (inside app.asar.unpacked) - most common for packaged apps
		const prodPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', platformDir, exeName)
		if (fs.existsSync(prodPath)) {
			console.log('✅ Using bundled cloudflared from production path:', prodPath)
			return prodPath
		}
		
		// Try development path (only works when running with npm start)
		// Use __dirname.replace to get unpacked path if we're inside asar
		let devPath = path.join(__dirname, 'bin', platformDir, exeName)
		// If __dirname contains app.asar, try the unpacked version
		if (__dirname.includes('app.asar') && !__dirname.includes('app.asar.unpacked')) {
			devPath = devPath.replace('app.asar', 'app.asar.unpacked')
		}
		if (fs.existsSync(devPath)) {
			console.log('✅ Using bundled cloudflared from development path:', devPath)
			return devPath
		}
		
		// Try another production path (not packed in asar - for Linux AppImage)
		const prodPath2 = path.join(process.resourcesPath, 'bin', platformDir, exeName)
		if (fs.existsSync(prodPath2)) {
			console.log('✅ Using bundled cloudflared from production path:', prodPath2)
			return prodPath2
		}
		
		// For macOS app bundle: Try app/bin path
		if (platform === 'darwin') {
			const macPath = path.join(process.resourcesPath, 'app', 'bin', platformDir, exeName)
			if (fs.existsSync(macPath)) {
				console.log('✅ Using bundled cloudflared from macOS app path:', macPath)
				return macPath
			}
		}
		
		// Log all paths tried for debugging
		console.log('⚠️  Tried cloudflared paths:')
		console.log('   - Dev:', devPath)
		console.log('   - Prod (asar.unpacked):', prodPath)
		console.log('   - Prod (resources):', prodPath2)
		if (platform === 'darwin') {
			console.log('   - macOS app:', path.join(process.resourcesPath, 'app', 'bin', platformDir, exeName))
		}
		console.log('   process.resourcesPath:', process.resourcesPath)
		console.log('   __dirname:', __dirname)
	}
	
	// Fall back to system installation
	console.log('⚠️  Bundled cloudflared not found, checking system installation...')
	return 'cloudflared' // Will use system PATH
}

/**
 * Start cloudflared quick tunnel to localhost:11434
 */
async function startCloudflaredTunnel() {
	try {
		const cloudflaredPath = getCloudflaredPath()
		
		// For bundled binaries, ensure executable permissions (Unix-like systems)
		if (fs.existsSync(cloudflaredPath) && cloudflaredPath !== 'cloudflared') {
			try {
				const stats = fs.statSync(cloudflaredPath)
				// Check if file is not executable, then make it executable
				if (os.platform() !== 'win32' && !(stats.mode & fs.constants.S_IXUSR)) {
					console.log('🔧 Setting executable permissions on cloudflared binary...')
					fs.chmodSync(cloudflaredPath, 0o755)
				}
			} catch (permError) {
				console.warn('⚠️  Could not set executable permissions:', permError.message)
			}
		}
		
		// Check if cloudflared is available
		try {
			execSync(`"${cloudflaredPath}" --version`, { 
				encoding: 'utf-8',
				stdio: 'pipe',
			})
			console.log('✅ cloudflared is available:', cloudflaredPath)
		} catch (e) {
			const isWindows = os.platform() === 'win32'
			const installCmd = isWindows ? 'winget install --id Cloudflare.cloudflared' : 
			                    os.platform() === 'darwin' ? 'brew install cloudflared' : 
			                    'sudo apt install cloudflared'
			console.warn(`❌ cloudflared not found. Install with: ${installCmd}`)
			console.warn('   Or download binaries manually - see bin/README.md')
			return null
		}

		console.log('📡 Starting cloudflared tunnel in background...')

		// Start cloudflared tunnel using detected path
		// cloudflared tunnel --url http://localhost:11434
		cloudflaredProcess = spawn(cloudflaredPath, [
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
		notifyRegistrationWarning('server-url-update-failed', error.response?.data?.error || error.response?.data?.code || error.message)
	}
}

function notifyRegistrationWarning(reason, detail) {
	try {
		if (mainWindow?.webContents) {
			mainWindow.webContents.send('registration-warning', { reason, detail })
		} else {
			console.warn('⚠️  No renderer window available to show registration warning')
		}
	} catch (notifyError) {
		console.warn('⚠️  Failed to notify renderer of registration warning:', notifyError.message)
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
	// Use .ico on Windows, .png on Linux (macOS icon comes from app bundle)
	let iconPath
	if (process.platform === 'win32') {
		iconPath = path.join(__dirname, 'ui', 'icon.ico')
	} else if (process.platform !== 'darwin') {
		iconPath = path.join(__dirname, 'ui', 'appicon.png')
	}
	
	const windowOptions = {
		width: 500,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			enableRemoteModule: false,
			nodeIntegration: false,
		},
	}
	
	// Set icon if file exists (but not on macOS - it comes from app bundle)
	if (iconPath && fs.existsSync(iconPath)) {
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

	// On Windows, ensure closing the window exits the app and cleans up
	mainWindow.on('close', () => {
		try {
			if (cloudflaredProcess) {
				cloudflaredProcess.kill()
				cloudflaredProcess = null
			}
		} catch (e) {}
		if (process.platform === 'win32') {
			app.quit()
		}
	})

	mainWindow.on('closed', () => {
		mainWindow = null
	})
}

/**
 * App event handlers
 */
app.on('ready', async () => {
	createWindow()
	
	// Configure Ollama for remote access on startup
	console.log('⚙️  Configuring Ollama for remote access on startup...')
	const configResult = await configureOllamaForRemote()
	if (configResult.success) {
		console.log('✅ Ollama configured successfully')
	} else {
		console.warn('⚠️  Ollama configuration failed, but app will continue:', configResult.error)
	}
	
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

// Extra safety: ensure child processes are killed on quit
app.on('will-quit', () => {
	try {
		if (cloudflaredProcess) {
			cloudflaredProcess.kill()
			cloudflaredProcess = null
		}
	} catch (e) {}
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
		const { deviceId, osInfo, hardware, nvidiaInfo, amdInfo, macInfo, gpuType } = systemInfo

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
					gpuType: gpuType,
					amdInfo: amdInfo,
					macInfo: macInfo,
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
		const amdInfo = getAmdInfo()
		const macInfo = getMacInfo()
		const platform = os.platform()
		const release = os.release()
		const arch = os.arch()
		
		// Determine which GPU to display
		let gpuInfo = nvidiaInfo
		let gpuType = 'nvidia'
		
		if (!nvidiaInfo.available && amdInfo.available) {
			gpuInfo = amdInfo
			gpuType = 'amd'
		} else if (!nvidiaInfo.available && !amdInfo.available && macInfo.available) {
			gpuInfo = macInfo
			gpuType = 'mac'
		}
		
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
			gpu: `${gpuInfo.name} (${gpuInfo.memory})`,
			memory: `${(totalMemory / (1024 ** 3)).toFixed(2)} GB`,
			nvidiaDriver: nvidiaInfo.driver,
			cuda: nvidiaInfo.cuda,
			models: models,
			url: tunnelUrl,
			gpuType: gpuType,
			nvidiaInfo: nvidiaInfo,
			amdInfo: amdInfo,
			macInfo: macInfo,
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

// Configure Ollama to accept remote connections
ipcMain.handle('configure-ollama-remote', async (event) => {
	try {
		console.log('📡 User triggered Ollama remote configuration...')
		const result = await configureOllamaForRemote()
		return result
	} catch (error) {
		console.error('Configuration error:', error.message)
		return {
			success: false,
			error: error.message || 'Failed to configure Ollama'
		}
	}
})

// Get Ollama logs for debugging
ipcMain.handle('get-ollama-logs', async (event) => {
	try {
		const logPath = path.join(os.homedir(), '.whistant_local', 'ollama.log')
		if (fs.existsSync(logPath)) {
			const logs = fs.readFileSync(logPath, 'utf-8')
			return { success: true, logs: logs }
		} else {
			return { success: true, logs: 'No logs found yet. Ollama may not have been started.' }
		}
	} catch (error) {
		return { success: false, error: error.message }
	}
})