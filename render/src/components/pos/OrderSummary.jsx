import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Button,
  Divider,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
} from '@mui/material';
import {
  Add,
  Remove,
  Delete,
  Payment,
  Print,
  Person,
  TableRestaurant,
  Receipt,
  ShoppingCart,
} from '@mui/icons-material';
import {
  updateItemQuantity,
  removeItemFromOrder,
  setDiscount,
  setAdditionalCharges,
  setCustomerInfo,
  clearCurrentOrder,
  createOrder,
  updateOrder,
  updateOrderStatus,
  fetchActiveOrders,
} from '../../store/slices/orderSlice';
import { openModal, closeModal } from '../../store/slices/uiSlice';
import { fetchItemVariants } from '../../store/slices/inventorySlice';
import { setActiveShift } from '../../store/slices/authSlice';
import { cashierShiftAPI } from '../../services/api';
import { toast } from 'react-toastify';
import htmlPrintService from '../../services/htmlPrintService';
import SetActiveDialog from './SetActiveDialog';

const OrderSummary = () => {
  const dispatch = useDispatch();
  const { currentOrder, loading } = useSelector((state) => state.order);
  const { modals } = useSelector((state) => state.ui);
  const { user, activeShift } = useSelector((state) => state.auth);

  const [paymentDialog, setPaymentDialog] = useState(false);
  const [setActiveDialogOpen, setSetActiveDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [discountType, setDiscountType] = useState('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [completedOrder, setCompletedOrder] = useState(null);

  // Clear local states when starting a new order
  useEffect(() => {
    if (!paymentDialog && currentOrder.items.length === 0 && !currentOrder.id) {
      setDiscountType('fixed');
      setDiscountValue('');
      setAmountPaid('');
    }
  }, [currentOrder.items.length, currentOrder.id, paymentDialog]);

  const formatPrice = (price) => {
    // Only check for NaN after parseFloat to handle string numbers correctly
    const parsedPrice = parseFloat(price);
    return `Rs. ${isNaN(parsedPrice) ? '0.00' : parsedPrice.toFixed(2)}`;
  };

  // Helper function to map order items for API
  const mapOrderItems = (items) => items.map(item => ({
    item_variant_id: item.itemVariantId,
    qty: item.quantity,
    unit_price: item.price
  }));

  const handleQuantityChange = (itemVariantId, newQuantity) => {
    if (newQuantity <= 0) {
      dispatch(removeItemFromOrder(itemVariantId));
    } else {
      dispatch(updateItemQuantity({ itemVariantId, quantity: newQuantity }));
    }
  };

  const handleUpdateOrder = async () => {
    if (currentOrder.items.length === 0) {
      toast.error('Order must have at least one item');
      return;
    }

    try {
      const orderData = {
        admin_id: user.id,
        items: mapOrderItems(currentOrder.items),
        additional_charges: currentOrder.additionalCharges,
        customer_name: currentOrder.customerName,
        tender_cash: parseFloat(amountPaid) || currentOrder.total,
        discount_type: discountType,
        discount_value: parseFloat(discountValue) || 0,
        status: currentOrder.originalStatus || 'completed' // Maintain original status
      };

      await dispatch(updateOrder({ orderId: currentOrder.id, orderData })).unwrap();
      toast.success(`Order #${currentOrder.id} updated successfully!`);
      
      // Refresh item variants to update quantities
      dispatch(fetchItemVariants());
      dispatch(fetchActiveOrders());
      
      // Clear the order
      dispatch(clearCurrentOrder());
      setDiscountType('fixed');
      setDiscountValue('');
      setAmountPaid('');
      
    } catch (error) {
      console.error('Update order error:', error);
      toast.error('Failed to update order: ' + error.message);
    }
  };

  const handlePlaceOrder = async () => {
    if (currentOrder.items.length === 0) return;

    try {
      let result;
      
      // If we're completing an existing active order
      if (currentOrder.id) {
        // Update the order with current items and status to completed
        const orderData = {
          admin_id: user.id,
          items: mapOrderItems(currentOrder.items),
          additional_charges: currentOrder.additionalCharges,
          customer_name: currentOrder.customerName,
          tender_cash: parseFloat(amountPaid),
          discount_type: discountType,
          discount_value: parseFloat(discountValue) || 0,
          status: 'completed'
        };

        result = await dispatch(updateOrder({ orderId: currentOrder.id, orderData })).unwrap();
        toast.success(`Order #${currentOrder.id} completed`);
      } else {
        // Create a new completed order
        const orderData = {
          admin_id: user.id,
          items: mapOrderItems(currentOrder.items),
          additional_charges: currentOrder.additionalCharges,
          customer_name: currentOrder.customerName,
          tender_cash: parseFloat(amountPaid),
          discount_type: discountType,
          discount_value: parseFloat(discountValue) || 0,
          status: 'completed'
        };

        result = await dispatch(createOrder(orderData)).unwrap();
      }
      
      // Refresh item variants to update quantities in POS interface
      dispatch(fetchItemVariants());
      
      // Store the completed order for printing
      setCompletedOrder({
        ...currentOrder,
        id: result.id,
        discount_type: discountType,
        discount_value: parseFloat(discountValue) || 0,
        paymentMethod: paymentMethod,
        amountPaid: parseFloat(amountPaid),
        tender_cash: parseFloat(amountPaid),
        cashier: user?.name || 'System'
      });
      
      // Set amountPaid for the dialog
      setAmountPaid(amountPaid);
      
      // Clear the current order immediately after placing
      dispatch(clearCurrentOrder());
      
      // Batch refresh operations for better performance
      dispatch(fetchActiveOrders());
      dispatch(fetchItemVariants());
      
      // Show payment dialog
      setPaymentDialog(true);
    } catch (error) {
      console.error('Place order error:', error);
      toast.error('Failed to complete order');
    }
  };

  const handleSetAsActive = async ({ customerName }) => {
    if (currentOrder.items.length === 0) return;

    const orderData = {
      admin_id: user.id,
      items: mapOrderItems(currentOrder.items),
      additional_charges: currentOrder.additionalCharges,
      customer_name: customerName || null,
      discount_type: discountType,
      discount_value: parseFloat(discountValue) || 0,
      status: 'active'
    };

    try {
      let result;
      
      // If we're updating an existing active order
      if (currentOrder.id) {
        // Update the existing order
        result = await dispatch(updateOrder({ orderId: currentOrder.id, orderData })).unwrap();
        toast.success(`Order #${currentOrder.id} updated`);
      } else {
        // Create a new active order
        result = await dispatch(createOrder(orderData)).unwrap();
        toast.success(`Order #${result.id} set as active`);
      }
      
      dispatch(clearCurrentOrder());
      // Refresh item variants to update quantities in POS interface
      dispatch(fetchItemVariants());
      // Refresh active orders list after creating/updating active order
      dispatch(fetchActiveOrders());
      setDiscountType('fixed');
      setDiscountValue('');
      setAmountPaid('');
      setSetActiveDialogOpen(false);
    } catch (error) {
      console.error('Failed to save active order:', error);
      toast.error('Failed to set order as active');
    }
  };

  const handlePaymentConfirm = async () => {
    try {
      // Print bill with proper store info
      const storeInfo = {
        name: 'BINTHANNA RESTAURANT',
        address: 'Kekirihena Mahaoya',
        phone: '076 670 2231',
        receiptFooter: 'Thank you for dining with us!',
        currencySymbol: 'Rs'
      };

      // Use HTML/CSS based printing (browser print dialog)
      const billResult = await htmlPrintService.printBillHTML(completedOrder || {
        ...currentOrder,
        id: Date.now(),
        paymentMethod: paymentMethod || 'cash',
        amountPaid: parseFloat(amountPaid) || currentOrder.total,
        cashier: user?.name || 'System',
        tender_cash: parseFloat(amountPaid) || currentOrder.total
      }, storeInfo);

      // Only show success if bill actually printed
      if (billResult.success) {
        toast.success('Bill printed successfully!');
        // Clear order and close dialog
        dispatch(clearCurrentOrder());
        // Refresh active orders list after completing order
        dispatch(fetchActiveOrders());
        setPaymentDialog(false);
        setAmountPaid('');
        setCompletedOrder(null);
        // Clear discount fields for new order
        setDiscountType('fixed');
        setDiscountValue('');
      } else {
        // Show error but still allow closing
        toast.error(billResult.message || 'Printer not connected. Please check printer.');
      }
      
    } catch (error) {
      toast.error(`Failed to print bill: ${error.message}`);
      console.error('Payment error:', error);
    }
  };

  const change = parseFloat(amountPaid) - currentOrder.total;

  return (
    <>
      <Card sx={{ height: '93vh', display: 'flex', flexDirection: 'column',overflow:'auto' }}>
        <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          

          {/* Cashier Shift Warning */}
          {user?.role === 'cashier' && !activeShift && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>No Active Shift:</strong> You must open a cashier shift to process orders. 
                Please open a shift from your profile menu in the top-right corner.
              </Typography>
            </Alert>
          )}

          {/* Edit Mode Indicator */}
          {currentOrder.isEditing && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Editing Order #{currentOrder.id}</strong> - Make changes and click "Update Order" to save.
              </Typography>
            </Alert>
          )}

          {/* Current loaded order header - moved from top of POS */}
          {currentOrder.id && (
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                Order #{currentOrder.id}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {currentOrder.customerName ? (
                  <Chip icon={<Person />} label={currentOrder.customerName} size="small" />
                ) : null}
              </Box>
            </Box>
          )}

          <Divider sx={{ mb: 2 }} />

          {/* Order Items */}
          <Box className="scrollbar-thin" sx={{ flexGrow: 1,bgcolor:'#f5f5f5', overflowY: 'auto' }}>
            {currentOrder.items.length === 0 ? (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '200px',
                  color: 'text.secondary',
                }}
              >
                <ShoppingCart sx={{ fontSize: 60, mb: 2, opacity: 0.5 }} />
                <Typography variant="body1">No items in order</Typography>
              </Box>
            ) : (
              <List dense>
                {currentOrder.items.map((item) => (
                  <ListItem
                    key={item.itemVariantId}
                    sx={{
                      border: '1px solid #e0e0e0',
                      borderRadius: 1,
                      mb: 0.5,
                      p: 0.5,
                      bgcolor: 'background.paper',
                      minHeight: '48px',
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="subtitle2" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
                            {item.itemName} {item.variantName && <span style={{ fontWeight: 'normal', color: '#666' }}>({item.variantName})</span>}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <IconButton
                                size="small"
                                onClick={() => handleQuantityChange(item.itemVariantId, item.quantity - 1)}
                                sx={{ p: 0.5 }}
                              >
                                <Remove fontSize="small" />
                              </IconButton>
                              <Typography variant="body2" fontWeight="bold" sx={{ fontSize: '0.8rem' }}>
                                {item.quantity}
                              </Typography>
                              <IconButton
                                size="small"
                                onClick={() => handleQuantityChange(item.itemVariantId, item.quantity + 1)}
                                sx={{ p: 0.5 }}
                              >
                                <Add fontSize="small" />
                              </IconButton>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="body2" fontWeight="bold" sx={{ fontSize: '0.8rem' }}>
                                {formatPrice(item.total)}
                              </Typography>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => dispatch(removeItemFromOrder(item.itemVariantId))}
                                sx={{ p: 0.5 }}
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            </Box>
                          </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>

          {/* Order Summary */}
          {currentOrder.items.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ space: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="body1">Items</Typography>
                  <Typography variant="body1">{currentOrder.items.length} (Items)</Typography>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="body1">Subtotal</Typography>
                  <Typography variant="body1">{formatPrice(currentOrder.subtotal)}</Typography>
                </Box>
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography variant="body1">Additional Charges</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2">Rs.</Typography>
                    <TextField
                      size="small"
                      type="number"
                      value={currentOrder.additionalCharges || ''}
                      onChange={(e) => dispatch(setAdditionalCharges(parseFloat(e.target.value) || 0))}
                      sx={{ width: 120 }}
                      inputProps={{ 
                        min: 0, 
                        step: 0.01,
                        style: { 
                          MozAppearance: 'textfield',
                          WebkitAppearance: 'none',
                          appearance: 'none'
                        }
                      }}
                    />
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography variant="body1">Discount</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Select
                      size="small"
                      value={discountType || 'fixed'}
                      onChange={(e) => {
                        setDiscountType(e.target.value);
                        setDiscountValue('');
                      }}
                      sx={{ width: 100 }}
                    >
                      <MenuItem value="fixed">Fixed</MenuItem>
                      <MenuItem value="percent">Percent</MenuItem>
                    </Select>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {discountType === 'fixed' && <Typography variant="body2">Rs.</Typography>}
                      <TextField
                        size="small"
                        type="number"
                        value={discountValue || ''}
                        onChange={(e) => {
                          const inputValue = e.target.value;
                          // Keep the raw string value to avoid floating point issues
                          setDiscountValue(inputValue);
                          
                          // Only dispatch if there's a value
                          if (inputValue) {
                            const numValue = parseFloat(inputValue);
                            if (!isNaN(numValue)) {
                              if (discountType === 'percent') {
                                // Round to 2 decimal places to avoid floating point errors
                                const discountAmount = Math.round((numValue / 100) * currentOrder.subtotal * 100) / 100;
                                dispatch(setDiscount(discountAmount));
                              } else {
                                // Round to 2 decimal places to avoid floating point errors
                                dispatch(setDiscount(Math.round(numValue * 100) / 100));
                              }
                            }
                          } else {
                            dispatch(setDiscount(0));
                          }
                        }}
                        sx={{ width: 100 }}
                        inputProps={{ 
                          min: 0, 
                          max: discountType === 'percent' ? 100 : undefined,
                          step: discountType === 'percent' ? 1 : 0.01,
                          style: { 
                            MozAppearance: 'textfield',
                            WebkitAppearance: 'none',
                            appearance: 'none'
                          }
                        }}
                      />
                      {discountType === 'percent' && <Typography variant="body2">%</Typography>}
                    </Box>
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box 
                  sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#1976d2',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                  }}
                >
                  <Typography variant="h6" fontWeight="bold" sx={{ color: '#ffffff' }}>Total</Typography>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#ffffff' }}>
                    {formatPrice(currentOrder.total)}
                  </Typography>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography variant="body1">Cash Tendered</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2">Rs.</Typography>
                    <TextField
                      size="small"
                      type="number"
                      value={amountPaid}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Only allow valid numbers with max 2 decimal places
                        if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
                          setAmountPaid(value);
                        }
                      }}
                      onBlur={(e) => {
                        // Round to 2 decimal places on blur if there's a value
                        if (e.target.value) {
                          const rounded = parseFloat(e.target.value).toFixed(2);
                          setAmountPaid(rounded);
                        }
                      }}
                      sx={{ width: 120 }}
                      inputProps={{ 
                        min: 0, 
                        step: 0.01,
                        style: { 
                          MozAppearance: 'textfield',
                          WebkitAppearance: 'none',
                          appearance: 'none'
                        }
                      }}
                    />
                  </Box>
                </Box>

                {amountPaid && (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backgroundColor: change >= 0 ? '#2e7d32' : '#d32f2f',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      mb: 2,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                    }}
                  >
                    <Typography variant="h6" fontWeight="bold" sx={{ color: '#ffffff' }}>Change</Typography>
                    <Typography variant="h5" fontWeight="bold" sx={{ color: '#ffffff' }}>
                      {formatPrice(change)}
                    </Typography>
                  </Box>
                )}

                <Divider sx={{ my: 1 }} />
                
              </Box>

              {/* Action Buttons */}
              <Box sx={{ mt: 2, space: 1 }}>
                {/* Show Update Order button if editing existing order */}
                {currentOrder.isEditing ? (
                  <>
                    <Button
                      fullWidth
                      variant="contained"
                      size="large"
                      startIcon={<Payment />}
                      onClick={handleUpdateOrder}
                      disabled={loading || currentOrder.items.length === 0 || currentOrder.total <= 0}
                      sx={{
                        mb: 1,
                        borderRadius: 2,
                        background: 'linear-gradient(45deg, #FF9800, #F57C00)',
                        fontSize: '1.1rem',
                        fontWeight: 'bold',
                        '&.Mui-disabled': {
                          background: 'linear-gradient(45deg, #9e9e9e, #757575)',
                          color: '#ffffff'
                        }
                      }}
                    >
                      Update Order
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={() => {
                        dispatch(clearCurrentOrder());
                        setDiscountType('fixed');
                        setDiscountValue('');
                        setAmountPaid('');
                      }}
                      sx={{ borderRadius: 2, mb: 1 }}
                    >
                      Cancel Edit
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      fullWidth
                      variant="contained"
                      size="large"
                      startIcon={<Payment />}
                      onClick={handlePlaceOrder}
                      disabled={loading || !amountPaid || change < 0 || currentOrder.total <= 0 || currentOrder.items.length === 0}
                      sx={{
                        mb: 1,
                        borderRadius: 2,
                        background: 'linear-gradient(45deg, #4ECDC4, #44A08D)',
                        fontSize: '1.1rem',
                        fontWeight: 'bold',
                        '&.Mui-disabled': {
                          background: 'linear-gradient(45deg, #9e9e9e, #757575)',
                          color: '#ffffff'
                        }
                      }}
                    >
                      Place Order
                    </Button>

                    <Button
                      fullWidth
                      variant="contained"
                      size="large"
                      onClick={() => setSetActiveDialogOpen(true)}
                      sx={{
                        mb: 1,
                        borderRadius: 2,
                        background: 'linear-gradient(45deg, #2196F3, #1976D2)',
                        fontSize: '1.1rem',
                        fontWeight: 'bold',
                        '&:hover': {
                          background: 'linear-gradient(45deg, #1976D2, #2196F3)'
                        }
                      }}
                    >
                      Set as Active
                    </Button>
                    
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={() => {
                        dispatch(clearCurrentOrder());
                        setDiscountType('fixed');
                        setDiscountValue('');
                        setAmountPaid('');
                      }}
                      sx={{ borderRadius: 2 }}
                    >
                      Clear Order
                    </Button>
                  </>
                )}
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      {/* Customer Info Dialog removed */}

      {/* Set Active Dialog */}
      <SetActiveDialog
        open={setActiveDialogOpen}
        onClose={() => setSetActiveDialogOpen(false)}
        onSave={handleSetAsActive}
        initialCustomerName={currentOrder.customerName}
      />

      {/* Payment Dialog */}
      <Dialog open={paymentDialog} onClose={() => setPaymentDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Payment Confirmation</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            Order placed successfully!
          </Alert>
          
          {/* Hidden: Total Amount - kept for backward compatibility */}
          <Typography variant="h6" gutterBottom sx={{ display: 'none' }}>
            Total Amount: {formatPrice(currentOrder.total)}
          </Typography>

          {/* Hidden: Payment Method - kept for backward compatibility */}
          <FormControl fullWidth sx={{ mb: 2, display: 'none' }}>
            <InputLabel>Payment Method</InputLabel>
            <Select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              label="Payment Method"
            >
              <MenuItem value="cash">Cash</MenuItem>
              <MenuItem value="card">Card</MenuItem>
              <MenuItem value="digital">Digital Payment</MenuItem>
            </Select>
          </FormControl>

          {/* Hidden: Amount Paid - kept for backward compatibility */}
          {paymentMethod === 'cash' && (
            <TextField
              fullWidth
              label="Amount Paid"
              type="number"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              InputProps={{ startAdornment: 'Rs. ' }}
              sx={{ mb: 2, display: 'none' }}
            />
          )}

          {/* Hidden: Change display - kept for backward compatibility */}
          {amountPaid && change >= 0 && paymentMethod === 'cash' && (
            <Typography variant="body2" sx={{ mb: 2, display: 'none' }}>
              Change: {formatPrice(change)}
            </Typography>
          )}

          {/* Hidden: Insufficient amount warning - kept for backward compatibility */}
          {amountPaid && change < 0 && paymentMethod === 'cash' && (
            <Typography variant="body2" color="error" sx={{ mb: 2, display: 'none' }}>
              Insufficient amount
            </Typography>
          )}

          {/* Print status section removed as we no longer use printResults */}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialog(false)}>Close</Button>
          <Button 
            onClick={handlePaymentConfirm} 
            variant="contained" 
            startIcon={<Receipt />}
            disabled={paymentMethod === 'cash' && change < 0}
          >
            Print Bill & Complete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default OrderSummary;
