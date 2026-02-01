import React, { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  Box,
  Typography,
  Chip,
  Alert,
  CircularProgress,
  Button,
  Divider
} from '@mui/material';
import { format } from 'date-fns';
import { toast } from 'react-toastify';

const SellPriceHistory = ({ itemVariantId, currentPrice, onPriceUpdate }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (itemVariantId) {
      fetchHistory();
    }
  }, [itemVariantId]);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');
    try {
      console.log('Fetching price history for item variant:', itemVariantId);
      const response = await fetch(`http://localhost:3001/api/sell-price-history/${itemVariantId}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Server returned ${response.status}`);
      }

      const data = await response.json();
      console.log('Price history data:', data);
      setHistory(data);
    } catch (err) {
      console.error('Error fetching price history:', err);
      const errorMessage = err.message || 'Failed to load price history';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    try {
      return format(new Date(dateString), 'MMM dd, yyyy HH:mm');
    } catch {
      return dateString;
    }
  };

  const formatPrice = (price) => {
    const numPrice = parseFloat(price);
    return isNaN(numPrice) ? 'Rs. 0.00' : `Rs. ${numPrice.toFixed(2)}`;
  };

  const calculatePriceChange = (currentPrice, previousPrice) => {
    const current = parseFloat(currentPrice);
    const previous = parseFloat(previousPrice);
    if (isNaN(current) || isNaN(previous) || previous === 0) return null;

    const change = ((current - previous) / previous) * 100;
    return change;
  };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* Current Price Display */}
      <Box sx={{ mb: 3, p: 2, bgcolor: 'primary.50', borderRadius: 2, border: '1px solid', borderColor: 'primary.200' }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Current Selling Price
        </Typography>
        <Typography variant="h4" color="primary" fontWeight="bold">
          {formatPrice(currentPrice)}
        </Typography>
      </Box>

      {/* History Table */}
      <Typography variant="h6" gutterBottom fontWeight="bold">
        Price History
      </Typography>
      <Divider sx={{ mb: 2 }} />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell><strong>Price</strong></TableCell>
                <TableCell><strong>Change</strong></TableCell>
                <TableCell><strong>Date & Time</strong></TableCell>
                <TableCell><strong>Updated By</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      No price history found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                history.map((record, index) => {
                  const priceChange = index < history.length - 1
                    ? calculatePriceChange(record.selling_price, history[index + 1].selling_price)
                    : null;

                  return (
                    <TableRow key={record.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="bold" color="primary">
                          {formatPrice(record.selling_price)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {priceChange !== null && (
                          <Chip
                            label={`${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%`}
                            color={priceChange > 0 ? 'success' : 'error'}
                            size="small"
                            sx={{ fontWeight: 'bold' }}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDate(record.created_at)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {record.staff_name || 'System'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {index === 0 ? (
                          <Chip label="Current" color="primary" size="small" />
                        ) : (
                          <Chip label="Historical" variant="outlined" size="small" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {history.length > 0 && (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'info.50', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Total price changes: {history.length - 1}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SellPriceHistory;