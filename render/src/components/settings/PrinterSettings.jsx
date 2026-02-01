import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material';
import { Print, CheckCircle, Error } from '@mui/icons-material';
import htmlPrintService from '../../services/htmlPrintService';
import { toast } from 'react-toastify';

const PrinterSettings = () => {
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('Generic / Text Only');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [printerStatus, setPrinterStatus] = useState(null);

  // Get IPC Renderer
  const getIpcRenderer = () => {
    try {
      if (typeof window !== 'undefined' && window.require) {
        const { ipcRenderer } = window.require('electron');
        return ipcRenderer;
      }
      return null;
    } catch (error) {
      console.error('Failed to get ipcRenderer:', error);
      return null;
    }
  };

  useEffect(() => {
    loadPrinters();
    // printer status checks removed because raw/ESC-POS printing service was replaced
  }, []);

  const loadPrinters = async () => {
    const ipcRenderer = getIpcRenderer();
    
    if (!ipcRenderer) {
      toast.warning('Printer features are only available in desktop app');
      return;
    }

    setLoading(true);
    try {
      const availablePrinters = await ipcRenderer.invoke('get-printers');
      setPrinters(availablePrinters);
      // Auto-select first Generic / Text Only printer if available
      const genericPrinter = availablePrinters.find(p => p.name.includes('Generic / Text Only'));
      if (genericPrinter) {
        setSelectedPrinter(genericPrinter.name);
      }
    } catch (error) {
      console.error('Error loading printers:', error);
      toast.error('Failed to load printers');
    } finally {
      setLoading(false);
    }
  };

  // Printer status checks for native printers are removed because
  // the app now defaults to browser-based printing. Desktop printer
  // discovery is still shown when running under Electron.

  const handlePrinterChange = (event) => {
    const newPrinter = event.target.value;
    setSelectedPrinter(newPrinter);
    toast.info('Printer selection saved locally (effective in desktop mode)');
  };

  const handleTestPrint = async () => {
    setTesting(true);
    try {
      // Use HTML print service to open a browser print preview as a test
      const sampleOrder = {
        id: 'TEST-PRINT',
        items: [{ itemName: 'Test Item', quantity: 1, price: 0.01 }],
        cashier: 'System'
      };
      const result = await htmlPrintService.printBillHTML(sampleOrder, { name: 'TEST PRINT' });
      if (result.success) {
        toast.success('Opened print preview (browser).');
      } else {
        toast.error(result.message || 'Could not open print preview');
      }
    } catch (error) {
      toast.error(`Test print error: ${error.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Print /> Printer Settings
        </Typography>
        
        <Divider sx={{ my: 2 }} />

        {!getIpcRenderer() && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Printer features are only available when running as a desktop application
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>Select Printer</InputLabel>
              <Select
                value={selectedPrinter}
                onChange={handlePrinterChange}
                label="Select Printer"
                disabled={!getIpcRenderer()}
              >
                {printers.length === 0 ? (
                  <MenuItem value="">No printers found</MenuItem>
                ) : (
                  printers.map((printer) => (
                    <MenuItem key={printer.name} value={printer.name}>
                      {printer.displayName || printer.name} 
                      {printer.isDefault && ' (Default)'}
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>

            {printerStatus && (
              <Alert 
                severity={printerStatus.connected ? 'success' : 'error'} 
                icon={printerStatus.connected ? <CheckCircle /> : <Error />}
                sx={{ mb: 2 }}
              >
                Printer Status: {printerStatus.connected ? 'Connected' : 'Not Connected'}
                <br />
                <Typography variant="caption">
                  Current Printer: {printerStatus.model}
                </Typography>
              </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                onClick={loadPrinters}
                disabled={!getIpcRenderer() || loading}
              >
                Refresh Printers
              </Button>
              
              <Button
                variant="contained"
                startIcon={testing ? <CircularProgress size={20} /> : <Print />}
                onClick={handleTestPrint}
                disabled={!getIpcRenderer() || testing || !printerStatus?.connected}
              >
                {testing ? 'Printing...' : 'Test Print'}
              </Button>
            </Box>

            <Box sx={{ mt: 3 }}>
              <Typography variant="body2" color="text.secondary">
                <strong>Note:</strong> Make sure your printer is turned on and properly connected.
                For thermal printers, ensure the paper is loaded correctly.
              </Typography>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PrinterSettings;
