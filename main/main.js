const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const expressServer = require('./server');
const { initializeDatabase, closeDatabase } = require('./database/init');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');

let mainWindow;
let server;
let tempFileCleanupInterval = null;

// Helper function to get the current main window
function getMainWindow() {
  return mainWindow;
}

// Clean up old temporary receipt files
function cleanupTempFiles() {
  const tempDir = os.tmpdir();
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000); // 1 hour in milliseconds

  try {
    const files = fs.readdirSync(tempDir);
    let cleanedCount = 0;

    files.forEach(file => {
      if (file.startsWith('receipt-') && file.endsWith('.txt')) {
        const filePath = path.join(tempDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < oneHourAgo) {
            fs.unlinkSync(filePath);
            cleanedCount++;
          }
        } catch (err) {
          // Ignore errors for individual files
        }
      }
    });

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old receipt files`);
    }
  } catch (err) {
    console.error('Error cleaning temp files:', err);
  }
}

// Start periodic temp file cleanup (every hour)
function startTempFileCleanup() {
  // Run immediately
  cleanupTempFiles();

  // Then run every hour
  tempFileCleanupInterval = setInterval(() => {
    cleanupTempFiles();
  }, 60 * 60 * 1000); // 1 hour

  console.log('Temp file cleanup schedule started');
}

// Stop temp file cleanup
function stopTempFileCleanup() {
  if (tempFileCleanupInterval) {
    clearInterval(tempFileCleanupInterval);
    tempFileCleanupInterval = null;
    console.log('Temp file cleanup schedule stopped');
  }
}

// ============ Printer IPC Handlers ============
// Register IPC handlers once when app is ready

function registerIPCHandlers() {
  // Check if printer is available
  ipcMain.handle('check-printer', async (event, printerName) => {
    try {
      // Use PowerShell to get printers (more reliable on Windows)
      return new Promise((resolve) => {
        const command = `powershell -Command "Get-Printer | Select-Object Name, Status, DriverName | ConvertTo-Json"`;

        exec(command, (error, stdout, stderr) => {
          if (error) {
            resolve({ connected: false, error: error.message });
            return;
          }

          try {
            let printers = [];
            if (stdout.trim()) {
              // Parse the JSON output
              const parsed = JSON.parse(stdout.trim());
              // If single object, wrap in array
              printers = Array.isArray(parsed) ? parsed : [parsed];
            }

            // Check if the requested printer exists and is online (case-insensitive)
            const printer = printers.find(p => p.Name.toLowerCase() === printerName.toLowerCase());

            // Consider printer connected if it exists and status is not explicitly offline/error
            const isConnected = printer && (!printer.Status || printer.Status.toLowerCase() !== 'offline' && printer.Status.toLowerCase() !== 'error');

            resolve({
              connected: isConnected,
              printer: printer,
              printers: printers.map(p => ({
                name: p.Name,
                displayName: p.Name,
                status: p.Status,
                driver: p.DriverName
              }))
            });
          } catch (parseError) {
            resolve({ connected: false, error: 'Failed to parse printer list' });
          }
        });
      });
    } catch (error) {
      return { connected: false, error: error.message };
    }
  });

  // Print receipt/bill using raw text
  ipcMain.handle('print-receipt', async (event, { content, printerName }) => {
    try {
      // For Windows, we'll use silent printing with the system printer
      // Create a temporary file with the receipt content
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `receipt-${Date.now()}.txt`);

      // Write the content to temp file
      fs.writeFileSync(tempFile, content, 'utf8');

      // Use Windows print command with better error handling
      return new Promise((resolve) => {
        // Use double quotes and better error handling
        const printCommand = `powershell -Command "try { Get-Content '${tempFile}' | Out-Printer -Name '${printerName}'; Write-Host 'Print command executed successfully' } catch { Write-Error $_.Exception.Message; exit 1 }"`;

        exec(printCommand, { timeout: 10000 }, (error, stdout, stderr) => {
          // Clean up temp file
          try {
            fs.unlinkSync(tempFile);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }

          if (error) {
            const errorMessage = stderr || error.message || 'Unknown print error';
            resolve({ success: false, error: errorMessage });
          } else {
            resolve({ success: true, message: 'Printed successfully' });
          }
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Get available printers
  ipcMain.handle('get-printers', async (event) => {
    try {
      // Use PowerShell to get printers
      return new Promise((resolve) => {
        const command = `powershell -Command "Get-Printer | Select-Object Name, Status, DriverName | ConvertTo-Json"`;

        exec(command, (error, stdout, stderr) => {
          if (error) {
            resolve([]);
            return;
          }

          try {
            let printers = [];
            if (stdout.trim()) {
              const parsed = JSON.parse(stdout.trim());
              printers = Array.isArray(parsed) ? parsed : [parsed];
            }

            const result = printers.map(p => ({
              name: p.Name,
              displayName: p.Name,
              status: p.Status,
              driver: p.DriverName,
              isDefault: false // PowerShell doesn't easily give default, but we can check status
            }));

            resolve(result);
          } catch (parseError) {
            resolve([]);
          }
        });
      });
    } catch (error) {
      return [];
    }
  });

  console.log('IPC handlers registered');
}

function createWindow() {
  // Initialize database first
  initializeDatabase();

  // Start Express server
  server = expressServer.listen(3001, () => {
    console.log('Express server running on port 3001');
  });

  // Set server timeout to prevent hanging connections
  server.timeout = 30000; // 30 seconds
  server.keepAliveTimeout = 65000; // 65 seconds

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../render/public/vite.svg'),
    show: false // Don't show until ready
  });

  // Determine if we're in development or production
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // Development: Load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');

    // Open DevTools in development
    mainWindow.webContents.openDevTools();

    // Reload on changes (optional - Vite handles this automatically)
    mainWindow.webContents.on('did-fail-load', () => {
      setTimeout(() => {
        mainWindow.loadURL('http://localhost:5173');
      }, 1000);
    });
  } else {
    // Production: Load from built files
    mainWindow.loadFile(path.join(__dirname, '../render/dist/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    if (isDev) {
      console.log('🚀 Development mode: Loading from Vite dev server');
      console.log('📱 Frontend: http://localhost:5173');
      console.log('🔧 Backend API: http://localhost:3001');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start temp file cleanup
  startTempFileCleanup();
}

// Wait for app to be ready
app.whenReady().then(() => {
  // Register IPC handlers once
  registerIPCHandlers();

  createWindow();

  try {
    // Remove default application menu (File/Edit/View/Window/Help)
    Menu.setApplicationMenu(null);
  } catch (err) {
    console.warn('Could not remove application menu:', err.message);
  }
});

// Graceful shutdown handler
app.on('before-quit', async (event) => {
  console.log('Application shutting down...');

  // Prevent default quit to allow cleanup
  event.preventDefault();

  try {
    // Stop temp file cleanup
    stopTempFileCleanup();

    // Close Express server
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log('Express server closed');
          resolve();
        });
      });
    }

    // Close database
    await closeDatabase();

    console.log('Cleanup completed, exiting...');

    // Now actually quit
    app.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle certificate errors in development
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (process.env.NODE_ENV === 'development') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});