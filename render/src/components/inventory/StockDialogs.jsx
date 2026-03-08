import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  TextField,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  FormControlLabel,
  Radio,
} from '@mui/material';

// ─── Add Stock Dialog ───────────────────────────────────────────────────────
export const AddStockDialog = ({ open, onClose, selectedItem, newStockData, setNewStockData, onSave }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>
      Add Stock to {selectedItem?.item_name || selectedItem?.name} -{' '}
      {selectedItem?.variant_name || selectedItem?.variant}
    </DialogTitle>
    <DialogContent>
      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Buying Price"
            type="number"
            value={newStockData.buyingPrice}
            onChange={(e) => setNewStockData({ ...newStockData, buyingPrice: e.target.value })}
            required
            InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Quantity"
            type="number"
            value={newStockData.quantity}
            onChange={(e) => setNewStockData({ ...newStockData, quantity: e.target.value })}
            required
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Expiry Date"
            type="date"
            value={newStockData.expiryDate}
            onChange={(e) => setNewStockData({ ...newStockData, expiryDate: e.target.value })}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Description / Batch Info"
            value={newStockData.description}
            onChange={(e) => setNewStockData({ ...newStockData, description: e.target.value })}
            placeholder="e.g., Batch #123"
          />
        </Grid>
      </Grid>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button onClick={onSave} variant="contained" color="primary">
        Add Stock
      </Button>
    </DialogActions>
  </Dialog>
);

// ─── Stock Batch Details Dialog ──────────────────────────────────────────────
export const StockBatchDialog = ({
  open,
  onClose,
  selectedItem,
  loadingStockBatch,
  filteredStockData,
  stockFilters,
  setStockFilters,
  dateFilters,
  setDateFilters,
  onEditStockBatch,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>
      Stock Details -{' '}
      {selectedItem?.item_name || selectedItem?.name} (
      {selectedItem?.variant_name || selectedItem?.variant})
    </DialogTitle>
    <DialogContent>
      {loadingStockBatch ? (
        <Box display="flex" justifyContent="center" p={3}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {stockFilters.type === 'stockIn' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Click on any stock-in row to edit initial and remaining quantities.
            </Alert>
          )}
          {stockFilters.type === 'sale' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Stock Out shows items sold through completed orders. Items are automatically deducted using FIFO.
            </Alert>
          )}

          {/* Date Filters */}
          <Box display="flex" gap={2} mb={2} p={2} bgcolor="grey.50" borderRadius={1}>
            <TextField
              label="From Date"
              type="date"
              value={dateFilters.fromDate}
              onChange={(e) => setDateFilters(prev => ({ ...prev, fromDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <TextField
              label="To Date"
              type="date"
              value={dateFilters.toDate}
              onChange={(e) => setDateFilters(prev => ({ ...prev, toDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <Button
              variant="outlined"
              size="small"
              onClick={() => setDateFilters({ fromDate: '', toDate: '' })}
              sx={{ alignSelf: 'flex-end' }}
            >
              Clear Dates
            </Button>
          </Box>

          {/* Type Radio Filter */}
          <Box display="flex" gap={3} mb={2} p={2} bgcolor="grey.50" borderRadius={1}>
            <FormControlLabel
              control={<Radio checked={stockFilters.type === 'stockIn'} onChange={() => setStockFilters({ type: 'stockIn' })} color="success" />}
              label="Stock In (Add Stock)"
            />
            <FormControlLabel
              control={<Radio checked={stockFilters.type === 'sale'} onChange={() => setStockFilters({ type: 'sale' })} color="error" />}
              label="Stock Out (Sales)"
            />
          </Box>

          <TableContainer component={Paper} sx={{ mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  {stockFilters.type === 'sale' && (
                    <>
                      <TableCell>Quantity Sold</TableCell>
                      <TableCell>Order ID</TableCell>
                      <TableCell>Staff</TableCell>
                    </>
                  )}
                  {stockFilters.type === 'stockIn' && (
                    <>
                      <TableCell>Initial Qty</TableCell>
                      <TableCell>Remaining Qty</TableCell>
                      <TableCell>Expiry Date</TableCell>
                    </>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredStockData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary">
                        No movements match the selected filters
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStockData.map((movement, index) => (
                    <TableRow
                      key={index}
                      onClick={() => stockFilters.type === 'stockIn' && onEditStockBatch(movement)}
                      sx={{
                        cursor: stockFilters.type === 'stockIn' ? 'pointer' : 'default',
                        '&:hover': stockFilters.type === 'stockIn' ? { backgroundColor: 'action.hover' } : {},
                      }}
                    >
                      <TableCell>
                        {movement.date
                          ? new Date(movement.date).toLocaleDateString()
                          : movement.created_at
                          ? new Date(movement.created_at).toLocaleDateString()
                          : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={stockFilters.type === 'stockIn' ? 'Stock In' : 'Stock Out'}
                          color={stockFilters.type === 'stockIn' ? 'success' : 'error'}
                          size="small"
                        />
                      </TableCell>
                      {stockFilters.type === 'sale' && (
                        <>
                          <TableCell>
                            <Typography variant="body2" fontWeight="bold" color="error.main">
                              -{movement.quantity || 0}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip label={`#${movement.reference_id || '-'}`} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell>{movement.staff_name || '-'}</TableCell>
                        </>
                      )}
                      {stockFilters.type === 'stockIn' && (
                        <>
                          <TableCell>{movement.initial_qty || movement.quantity || 0}</TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight="bold">
                              {movement.remaining_qty !== undefined ? movement.remaining_qty : 'N/A'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {movement.expire_date ? new Date(movement.expire_date).toLocaleDateString() : '-'}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Close</Button>
    </DialogActions>
  </Dialog>
);

// ─── Edit Stock Batch Dialog ─────────────────────────────────────────────────
export const EditStockBatchDialog = ({
  open,
  onClose,
  editingStockBatch,
  editStockBatchData,
  setEditStockBatchData,
  onSave,
  saving,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Edit Stock Batch</DialogTitle>
    <DialogContent>
      <Box sx={{ mt: 2 }}>
        {editingStockBatch && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Editing stock batch from{' '}
            {editingStockBatch.date
              ? new Date(editingStockBatch.date).toLocaleDateString()
              : editingStockBatch.created_at
              ? new Date(editingStockBatch.created_at).toLocaleDateString()
              : 'N/A'}
          </Alert>
        )}
        <Alert severity="warning" sx={{ mb: 2 }}>
          This feature is available for administrators only.
        </Alert>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Initial Quantity"
              type="number"
              value={editStockBatchData.initial_qty}
              onChange={(e) => setEditStockBatchData({ ...editStockBatchData, initial_qty: e.target.value })}
              inputProps={{ min: 0, step: 1 }}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Remaining Quantity"
              type="number"
              value={editStockBatchData.remaining_qty}
              onChange={(e) => setEditStockBatchData({ ...editStockBatchData, remaining_qty: e.target.value })}
              inputProps={{ min: 0, step: 1 }}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Buying Price"
              type="number"
              value={editStockBatchData.buy_price}
              onChange={(e) => setEditStockBatchData({ ...editStockBatchData, buy_price: e.target.value })}
              inputProps={{ min: 0, step: 0.01 }}
              InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Expiry Date"
              type="date"
              value={editStockBatchData.expire_date}
              onChange={(e) => setEditStockBatchData({ ...editStockBatchData, expire_date: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Description"
              multiline
              rows={2}
              value={editStockBatchData.description}
              onChange={(e) => setEditStockBatchData({ ...editStockBatchData, description: e.target.value })}
              placeholder="Optional notes about this stock batch"
            />
          </Grid>
        </Grid>
      </Box>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={saving}>Cancel</Button>
      <Button onClick={onSave} variant="contained" color="primary" disabled={saving}>
        {saving ? <CircularProgress size={24} /> : 'Save'}
      </Button>
    </DialogActions>
  </Dialog>
);

// ─── Barcode Print Dialog ────────────────────────────────────────────────────
export const BarcodePrintDialog = ({
  open,
  onClose,
  selectedItem,
  barcodePrintQuantity,
  setBarcodePrintQuantity,
  onPrint,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Print Barcode Labels</DialogTitle>
    <DialogContent>
      {selectedItem && (
        <Box sx={{ pt: 2 }}>
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
            <Typography variant="subtitle1" fontWeight="bold">
              {selectedItem.item_name || selectedItem.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedItem.variant_name || selectedItem.variant}
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', gap: 2 }}>
              <Typography variant="body2">
                <strong>Barcode:</strong> {selectedItem.barcode}
              </Typography>
              <Typography variant="body2">
                <strong>Price:</strong> Rs.{' '}
                {parseFloat(selectedItem.selling_price || selectedItem.price || 0).toFixed(2)}
              </Typography>
            </Box>
          </Box>
          <TextField
            fullWidth
            label="Number of Labels"
            type="number"
            value={barcodePrintQuantity}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                setBarcodePrintQuantity('');
              } else {
                const num = parseInt(val);
                if (!isNaN(num)) setBarcodePrintQuantity(Math.min(500, Math.max(1, num)));
              }
            }}
            onBlur={() => {
              if (!barcodePrintQuantity || barcodePrintQuantity < 1) setBarcodePrintQuantity(1);
            }}
            inputProps={{ min: 1, max: 500 }}
            helperText="Labels will be printed in 3-column layout (35mm x 20mm each)"
          />
        </Box>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="contained" color="primary" onClick={onPrint}>
        Print Labels
      </Button>
    </DialogActions>
  </Dialog>
);
