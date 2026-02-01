import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Typography,
  Box,
  CircularProgress,
  Tooltip,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TablePagination,
  Alert,
} from '@mui/material';
import {
  History,
  Refresh,
  Restaurant,
  Person,
  Print,
  LocalDining,
  LocalBar,
  Receipt,
  Edit,
  Visibility,
  Delete,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import htmlPrintService from '../../services/htmlPrintService';
import { loadOrderForEdit } from '../../store/slices/orderSlice';

const OrderHistoryDialog = ({ open, onClose }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedItems, setEditedItems] = useState([]);
  const [savingOrder, setSavingOrder] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);

  useEffect(() => {
    if (open) {
      fetchOrders();
    }
  }, [open, page, rowsPerPage, dateFrom, dateTo, statusFilter]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page + 1,
        limit: rowsPerPage,
      });

      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (statusFilter) params.append('status', statusFilter);

      const response = await fetch(`http://localhost:3001/api/orders?${params}`);
      const data = await response.json();

      setOrders(data.orders || []);
      setTotalOrders(data.pagination?.total || 0);
      setTotalAmount(data.totalAmount || 0);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      toast.error('Failed to load order history');
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = async (order, isEdit = false) => {
    try {
      const response = await fetch(`http://localhost:3001/api/orders/${order.id}`);
      const fullOrder = await response.json();
      setSelectedOrder(fullOrder);
      setEditedItems(fullOrder.items || []);
      setEditMode(isEdit);
      setPreviewOpen(true);
    } catch (error) {
      console.error('Failed to load order details:', error);
      toast.error('Failed to load order details');
    }
  };

  const handleEditOrder = async (order, e) => {
    e.stopPropagation();
    try {
      // Fetch full order details
      const response = await fetch(`http://localhost:3001/api/orders/${order.id}`);
      const fullOrder = await response.json();
      
      // Load order into Redux state
      dispatch(loadOrderForEdit(fullOrder));
      
      // Close dialog and navigate to POS
      onClose();
      navigate('/pos');
      
      toast.info('Order loaded for editing. Update items and click "Update Order" to save changes.');
    } catch (error) {
      console.error('Failed to load order for editing:', error);
      toast.error('Failed to load order for editing');
    }
  };

  const handlePreviewOrder = (order, e) => {
    e.stopPropagation();
    handleRowClick(order, false);
  };

  const handleUpdateItemQuantity = (index, newQty) => {
    if (newQty <= 0) return;
    const updated = [...editedItems];
    updated[index] = { ...updated[index], quantity: newQty, qty: newQty };
    setEditedItems(updated);
  };

  const handleRemoveItem = (index) => {
    const updated = editedItems.filter((_, i) => i !== index);
    setEditedItems(updated);
  };

  const handleSaveEditedOrder = async () => {
    if (editedItems.length === 0) {
      toast.error('Order must have at least one item');
      return;
    }

    setSavingOrder(true);
    try {
      // Calculate new total
      const newTotal = editedItems.reduce((sum, item) => {
        const qty = parseFloat(item.quantity || item.qty || 0);
        const price = parseFloat(item.price || item.unit_price || 0);
        return sum + (qty * price);
      }, 0);

      // Update order
      const response = await fetch(`http://localhost:3001/api/orders/${selectedOrder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: editedItems.map(item => ({
            item_variant_id: item.item_variant_id,
            qty: item.quantity || item.qty,
            unit_price: item.price || item.unit_price
          })),
          total_amount: newTotal
        })
      });

      if (!response.ok) throw new Error('Failed to update order');

      toast.success('Order updated successfully!');
      setPreviewOpen(false);
      setEditMode(false);
      fetchOrders(); // Refresh the list
    } catch (error) {
      console.error('Failed to update order:', error);
      toast.error('Failed to update order: ' + error.message);
    } finally {
      setSavingOrder(false);
    }
  };

  const handlePrintKOT = async () => {
    if (!selectedOrder) return;

    try {
      const orderData = {
        ...selectedOrder,
        items: selectedOrder.items || [],
        cashier: 'System'
      };

      const kotResult = await htmlPrintService.printKOTHTML(orderData, {
        name: 'BINTHANNA RESTAURANT',
        receiptFooter: 'Please prepare hot meal items.'
      });

      if (kotResult.success) {
        toast.success('KOT printed successfully');
      } else {
        toast.error(kotResult.message || 'KOT printing failed');
      }
    } catch (error) {
      toast.error(`Failed to print KOT: ${error.message}`);
    }
  };

  const handlePrintBOT = async () => {
    if (!selectedOrder) return;

    try {
      const orderData = {
        ...selectedOrder,
        items: selectedOrder.items || [],
        cashier: 'System'
      };

      const botResult = await htmlPrintService.printBOTHTML(orderData, {
        name: 'BINTHANNA RESTAURANT',
        receiptFooter: 'Please prepare drinks.'
      });

      if (botResult.success) {
        toast.success('BOT printed successfully');
      } else {
        toast.error(botResult.message || 'BOT printing failed');
      }
    } catch (error) {
      toast.error(`Failed to print BOT: ${error.message}`);
    }
  };

  const handlePrintBill = async () => {
    if (!selectedOrder) return;

    try {
      const orderData = {
        ...selectedOrder,
        items: selectedOrder.items || [],
        cashier: selectedOrder.staff_name || 'System',
        paymentMethod: 'cash',
        amountPaid: selectedOrder.tender_cash,
        tender_cash: selectedOrder.tender_cash
      };

      const storeInfo = {
        name: 'BINTHANNA RESTAURANT',
        address: '123 Restaurant Street, City',
        phone: '+1 234 567 8900',
        taxRate: 0.10,
        receiptFooter: 'Thank you for dining with us!',
        currencySymbol: 'Rs.'
      };

      const billResult = await htmlPrintService.printBillHTML(orderData, storeInfo);

      if (billResult.success) {
        toast.success('Bill printed successfully');
      } else {
        toast.error(billResult.message || 'Bill printing failed');
      }
    } catch (error) {
      toast.error(`Failed to print bill: ${error.message}`);
    }
  };

  const formatPrice = (price) => {
    const numPrice = parseFloat(price);
    return isNaN(numPrice) ? 'Rs. 0.00' : `Rs. ${numPrice.toFixed(2)}`;
  };

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'success';
      case 'active': return 'warning';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const handlePageChange = (event, newPage) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleFilterChange = () => {
    setPage(0); // Reset to first page when filters change
    fetchOrders();
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <History />
              Order History
            </Box>
            <IconButton
              onClick={fetchOrders}
              color="primary"
              size="small"
              disabled={loading}
            >
              <Refresh />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ overflow: 'visible' }}>
          {/* Filters */}
          <Box sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="From Date"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ minWidth: 150 }}
            />
            <TextField
              label="To Date"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ minWidth: 150 }}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                label="Status"
                MenuProps={{
                  PaperProps: {
                    style: {
                      maxHeight: 300,
                    },
                  },
                }}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
              </Select>
            </FormControl>
            <Button variant="outlined" onClick={handleFilterChange}>
              Apply Filters
            </Button>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : orders.length === 0 ? (
            <Box sx={{ textAlign: 'center', p: 4, color: 'text.secondary' }}>
              <History sx={{ fontSize: 60, mb: 2, opacity: 0.3 }} />
              <Typography variant="h6">No orders found</Typography>
              <Typography variant="body2">
                Try adjusting your filters
              </Typography>
            </Box>
          ) : (
            <>
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.100' }}>
                      <TableCell><strong>Order #</strong></TableCell>
                      <TableCell><strong>Table / Customer</strong></TableCell>
                      <TableCell><strong>Date & Time</strong></TableCell>
                      <TableCell align="right"><strong>Total</strong></TableCell>
                      <TableCell align="center"><strong>Status</strong></TableCell>
                      <TableCell align="center"><strong>Actions</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow
                        key={order.id}
                        sx={{
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <TableCell>
                          <Typography variant="body2" fontWeight="bold">
                            #{order.id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Box>
                            {order.table_number && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Restaurant fontSize="small" color="action" />
                                <Typography variant="body2">
                                  Table {order.table_number}
                                </Typography>
                              </Box>
                            )}
                            {order.customer_name && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Person fontSize="small" color="action" />
                                <Typography variant="body2">
                                  {order.customer_name}
                                </Typography>
                              </Box>
                            )}
                            {!order.table_number && !order.customer_name && (
                              <Typography variant="body2" color="text.secondary">
                                N/A
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {formatDateTime(order.date)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight="bold">
                            {formatPrice(order.total_amount)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={order.status}
                            size="small"
                            color={getStatusColor(order.status)}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                            <Tooltip title="Edit Order">
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={(e) => handleEditOrder(order, e)}
                              >
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Preview Order">
                              <IconButton
                                size="small"
                                color="info"
                                onClick={(e) => handlePreviewOrder(order, e)}
                              >
                                <Visibility fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <TablePagination
                component="div"
                count={totalOrders}
                page={page}
                onPageChange={handlePageChange}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={handleRowsPerPageChange}
                rowsPerPageOptions={[5, 10, 25, 50]}
              />

              {/* Total Amount */}
              <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                <Typography variant="h6" align="center">
                  Total Orders: {totalOrders} | Total Amount: {formatPrice(totalAmount)}
                </Typography>
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Order Preview Dialog */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">
              Order #{selectedOrder?.id} - {editMode ? 'Edit Order' : 'Preview'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {!editMode && (
                <>
                  <Button
                    variant="outlined"
                    startIcon={<LocalDining />}
                    onClick={handlePrintKOT}
                    size="small"
                  >
                    Print KOT
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<LocalBar />}
                    onClick={handlePrintBOT}
                    size="small"
                  >
                    Print BOT
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<Receipt />}
                    onClick={handlePrintBill}
                    size="small"
                  >
                    Print Bill
                  </Button>
                </>
              )}
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ overflow: 'visible' }}>
          {selectedOrder && (
            <Box>
              {/* Order Info */}
              <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Chip
                  label={`Status: ${selectedOrder.status}`}
                  color={getStatusColor(selectedOrder.status)}
                />
                {selectedOrder.table_number && (
                  <Chip icon={<Restaurant />} label={`Table ${selectedOrder.table_number}`} />
                )}
                {selectedOrder.customer_name && (
                  <Chip icon={<Person />} label={selectedOrder.customer_name} />
                )}
                <Chip label={`Date: ${formatDateTime(selectedOrder.date)}`} />
              </Box>

              {/* Order Items */}
              {editMode && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  <strong>Edit Mode:</strong> Update quantities or remove items. Changes will affect inventory and order total.
                </Alert>
              )}
              <Typography variant="h6" gutterBottom>Order Items</Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Item</strong></TableCell>
                      <TableCell align="center"><strong>Qty</strong></TableCell>
                      <TableCell align="right"><strong>Unit Price</strong></TableCell>
                      <TableCell align="right"><strong>Total</strong></TableCell>
                      {editMode && <TableCell align="center"><strong>Actions</strong></TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(editMode ? editedItems : (selectedOrder.items || [])).map((item, index) => {
                      const qty = parseFloat(item.quantity || item.qty || 0);
                      const price = parseFloat(item.price || item.unit_price || 0);
                      return (
                        <TableRow key={index}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="bold">
                              {item.item_name}
                            </Typography>
                            {item.variant_name && (
                              <Typography variant="caption" color="text.secondary">
                                {item.variant_name}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="center">
                            {editMode ? (
                              <TextField
                                type="number"
                                size="small"
                                value={qty}
                                onChange={(e) => handleUpdateItemQuantity(index, parseFloat(e.target.value) || 0)}
                                inputProps={{ min: 1, style: { textAlign: 'center', width: '60px' } }}
                              />
                            ) : (
                              qty
                            )}
                          </TableCell>
                          <TableCell align="right">{formatPrice(price)}</TableCell>
                          <TableCell align="right">{formatPrice(qty * price)}</TableCell>
                          {editMode && (
                            <TableCell align="center">
                              <Tooltip title="Remove item">
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => handleRemoveItem(index)}
                                  disabled={editedItems.length === 1}
                                >
                                  <Delete fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Order Summary */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" gutterBottom>Order Summary</Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table>
                    <TableBody>
                      {/* Subtotal */}
                      <TableRow>
                        <TableCell><strong>Subtotal</strong></TableCell>
                        <TableCell align="right">
                          {formatPrice((editMode ? editedItems : (selectedOrder.items || [])).reduce((sum, item) => {
                            const qty = parseFloat(item.quantity || item.qty || 0);
                            const price = parseFloat(item.price || item.unit_price || 0);
                            return sum + (qty * price);
                          }, 0))}
                        </TableCell>
                      </TableRow>

                      {/* Additional Charges */}
                      <TableRow>
                        <TableCell>Additional Charges</TableCell>
                        <TableCell align="right">
                          {selectedOrder.additional_charges && parseFloat(selectedOrder.additional_charges) > 0 ? formatPrice(selectedOrder.additional_charges) : '00'}
                        </TableCell>
                      </TableRow>

                      {/* Discount */}
                      {(() => {
                        const subtotal = (selectedOrder.items || []).reduce((sum, item) => sum + (item.qty * item.unit_price), 0);
                        const additionalCharges = parseFloat(selectedOrder.additional_charges || 0);
                        const discountValue = parseFloat(selectedOrder.discount_value || 0);
                        let actualDiscount = 0;
                        if (selectedOrder.discount_type === 'percent') {
                          actualDiscount = (subtotal * discountValue) / 100;
                        } else if (selectedOrder.discount_type === 'fixed') {
                          actualDiscount = discountValue;
                        }
                        return actualDiscount > 0 ? (
                          <TableRow>
                            <TableCell>Discount</TableCell>
                            <TableCell align="right" sx={{ color: 'error.main' }}>
                              {selectedOrder.discount_type === 'percent' ? `${discountValue}% / ${formatPrice(actualDiscount)}` : `-${formatPrice(actualDiscount)}`}
                            </TableCell>
                          </TableRow>
                        ) : null;
                      })()}

                      {/* Cash Tender */}
                      {selectedOrder.tender_cash && parseFloat(selectedOrder.tender_cash) > 0 && (
                        <TableRow>
                          <TableCell>Cash Tendered</TableCell>
                          <TableCell align="right">
                            {formatPrice(selectedOrder.tender_cash)}
                          </TableCell>
                        </TableRow>
                      )}

                      {/* Change */}
                      {selectedOrder.tender_cash && selectedOrder.tender_cash > selectedOrder.total_amount && (
                        <TableRow>
                          <TableCell>Change</TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>
                            {formatPrice(selectedOrder.tender_cash - selectedOrder.total_amount)}
                          </TableCell>
                        </TableRow>
                      )}

                      {/* Total */}
                      <TableRow sx={{ bgcolor: 'grey.100' }}>
                        <TableCell><strong>Total Amount</strong></TableCell>
                        <TableCell align="right">
                          <Typography variant="h6" color="primary" fontWeight="bold">
                            {formatPrice(selectedOrder.total_amount)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {editMode ? (
            <>
              <Button 
                onClick={() => {
                  setEditMode(false);
                  setEditedItems(selectedOrder.items || []);
                }}
                disabled={savingOrder}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSaveEditedOrder}
                variant="contained"
                color="primary"
                disabled={savingOrder || editedItems.length === 0}
              >
                {savingOrder ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          ) : (
            <Button onClick={() => setPreviewOpen(false)}>Close</Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};

export default OrderHistoryDialog;