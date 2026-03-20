import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  Remove,
  Delete,
  Payment,
  Person,
  Receipt,
  ShoppingCart,
  Refresh,
  LocalOffer,
  Edit as EditIcon,
} from '@mui/icons-material';
import {
  updateItemQuantity,
  removeItemFromOrder,
  setDiscount,
  resetItemDiscount,
  updateItemDiscount,
  clearCurrentOrder,
  createOrder,
  updateOrder,
  fetchActiveOrders,
  setReturnReason,
} from '../../store/slices/orderSlice';
import { fetchItemVariants } from '../../store/slices/inventorySlice';
import { fetchActiveShift } from '../../store/slices/cashierShiftSlice';
import { setActiveShift } from '../../store/slices/authSlice';
import api from '../../services/api';
import { toast } from 'react-toastify';
import htmlPrintService from '../../services/htmlPrintService';
import SetActiveDialog from './SetActiveDialog';

const OrderSummary = () => {
  const dispatch = useDispatch();
  const { currentOrder, loading } = useSelector((state) => state.order);
  const { user, activeShift } = useSelector((state) => state.auth);

  const [paymentDialog, setPaymentDialog] = useState(false);
  const [setActiveDialogOpen, setSetActiveDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [discountType, setDiscountType] = useState('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [completedOrder, setCompletedOrder] = useState(null);
  const [editDiscountItem, setEditDiscountItem] = useState(null);
  const [editDiscountType, setEditDiscountType] = useState('percentage');
  const [editDiscountValue, setEditDiscountValue] = useState('');
  const [globalDiscountSettings, setGlobalDiscountSettings] = useState(null);

  const hasReturnItems = currentOrder.isReturnOrder && (currentOrder.returnedItems || []).length > 0;
  const hasOrderContent = currentOrder.items.length > 0 || hasReturnItems;
  const requiresCashTender = currentOrder.total > 0;
  const paidAmount = parseFloat(amountPaid || 0) || 0;
  const change = paidAmount - currentOrder.total;

  const dialogTotal = parseFloat(completedOrder?.total || 0) || 0;
  const dialogChange = paidAmount - dialogTotal;

  const effectiveOrderDiscount = useMemo(() => {
    if (currentOrder.isReturnOrder) {
      return {
        discountType: null,
        discountValue: 0,
        discountAmount: 0,
        blockedByMinimum: false,
        minimumOrderAmount: 0,
      };
    }

    const safeSubtotal = parseFloat(currentOrder.subtotal || 0) || 0;
    const safeDiscountType = discountType || null;
    const safeDiscountValue = parseFloat(discountValue || 0) || 0;

    if (!safeDiscountType || safeDiscountValue <= 0 || currentOrder.items.length === 0) {
      return {
        discountType: null,
        discountValue: 0,
        discountAmount: 0,
        blockedByMinimum: false,
        minimumOrderAmount: 0,
      };
    }

    const roundToTwo = (value) => Math.round(value * 100) / 100;

    if (globalDiscountSettings?.is_global_discount_active) {
      const globalType = globalDiscountSettings.global_discount_type === 'percentage' ? 'percent' : 'fixed';
      const globalValue = parseFloat(globalDiscountSettings.global_discount_value || 0) || 0;
      const minimumOrderAmount = parseFloat(globalDiscountSettings.min_order_amount || 0) || 0;
      const matchesGlobalConfig =
        safeDiscountType === globalType
        && Math.abs(safeDiscountValue - globalValue) < 0.0001;

      if (matchesGlobalConfig && safeSubtotal < minimumOrderAmount) {
        return {
          discountType: null,
          discountValue: 0,
          discountAmount: 0,
          blockedByMinimum: true,
          minimumOrderAmount,
        };
      }
    }

    const computedAmount = safeDiscountType === 'percent'
      ? roundToTwo((safeDiscountValue / 100) * safeSubtotal)
      : roundToTwo(safeDiscountValue);

    return {
      discountType: safeDiscountType,
      discountValue: safeDiscountValue,
      discountAmount: computedAmount,
      blockedByMinimum: false,
      minimumOrderAmount: 0,
    };
  }, [
    currentOrder.isReturnOrder,
    currentOrder.items.length,
    currentOrder.subtotal,
    discountType,
    discountValue,
    globalDiscountSettings,
  ]);

  useEffect(() => {
    api.globalDiscount.get().then((settings) => {
      setGlobalDiscountSettings(settings);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (currentOrder.isReturnOrder) {
      if (discountType !== 'fixed') {
        setDiscountType('fixed');
      }
      if (discountValue !== '') {
        setDiscountValue('');
      }
      if (currentOrder.discount !== 0) {
        dispatch(setDiscount(0));
      }
      return;
    }

    if (globalDiscountSettings?.is_global_discount_active && parseFloat(globalDiscountSettings.global_discount_value) > 0) {
      const gType = globalDiscountSettings.global_discount_type;
      const gValue = parseFloat(globalDiscountSettings.global_discount_value);
      const minOrderAmount = parseFloat(globalDiscountSettings.min_order_amount || 0) || 0;
      const hasItems = currentOrder.items.length > 0;
      const meetsMinOrder = currentOrder.subtotal >= minOrderAmount;
      const uiType = gType === 'percentage' ? 'percent' : 'fixed';

      if (discountType !== uiType) {
        setDiscountType(uiType);
      }
      if (discountValue !== String(gValue)) {
        setDiscountValue(String(gValue));
      }

      const computedDiscount = hasItems && meetsMinOrder
        ? (uiType === 'percent'
          ? Math.round((gValue / 100) * currentOrder.subtotal * 100) / 100
          : Math.round(gValue * 100) / 100)
        : 0;

      if (Math.abs((parseFloat(currentOrder.discount) || 0) - computedDiscount) > 0.001) {
        dispatch(setDiscount(computedDiscount));
      }
    }
  }, [currentOrder.isReturnOrder, currentOrder.discount, globalDiscountSettings, currentOrder.items.length, currentOrder.subtotal, discountType, discountValue, dispatch]);

  useEffect(() => {
    if (!paymentDialog && currentOrder.items.length === 0 && !hasReturnItems && !currentOrder.id) {
      setDiscountType('fixed');
      setDiscountValue('');
      setAmountPaid('');
    }
  }, [currentOrder.items.length, currentOrder.id, hasReturnItems, paymentDialog]);

  const formatPrice = (price) => {
    const parsedPrice = parseFloat(price);
    return `Rs. ${Number.isFinite(parsedPrice) ? parsedPrice.toFixed(2) : '0.00'}`;
  };

  const isValidDecimalInput = (value) => value === '' || /^\d*\.?\d{0,2}$/.test(value);

  const mapOrderItems = (items) => items.map((item) => ({
    item_variant_id: item.itemVariantId,
    qty: item.quantity,
    unit_price: item.price,
    original_price: item.originalPrice || item.price,
    discount_source: currentOrder.isReturnOrder ? null : (item.discountSource || null),
    discount_type: currentOrder.isReturnOrder ? null : (item.discountType || null),
    discount_value: currentOrder.isReturnOrder ? 0 : (item.discountValue || 0),
    discount_amount: currentOrder.isReturnOrder ? 0 : (item.discountAmount || 0),
    preferred_batch_id: item.preferredBatchId || null,
  }));

  const mapReturnItems = (returnedItems) => returnedItems.map((item) => ({
    source_order_item_id: item.source_order_item_id || null,
    item_variant_id: item.item_variant_id,
    qty: item.qty,
    unit_price: item.unit_price,
    original_price: item.original_price || item.unit_price,
    batch_allocations: Array.isArray(item.batch_allocations) ? item.batch_allocations : [],
  }));

  const resetOrderUiState = () => {
    setDiscountType('fixed');
    setDiscountValue('');
    setAmountPaid('');
    setEditDiscountItem(null);
    setEditDiscountValue('');
    setCompletedOrder(null);
  };

  const refreshCashOnHand = async () => {
    if (!user?.id || user.role !== 'cashier') {
      return;
    }

    try {
      const activeShiftData = await dispatch(fetchActiveShift(user.id)).unwrap();
      dispatch(setActiveShift(activeShiftData || null));
    } catch (_error) {}
  };

  const handleQuantityChange = (item, newQuantity) => {
    const lineKey = item.lineKey;

    if (newQuantity <= 0) {
      dispatch(removeItemFromOrder(lineKey));
    } else {
      const otherVariantQty = currentOrder.items
        .filter((orderItem) => orderItem.itemVariantId === item.itemVariantId && orderItem.lineKey !== lineKey)
        .reduce((sum, orderItem) => sum + (parseFloat(orderItem.quantity || 0) || 0), 0);

      const maxByVariant = item.maxVariantStock !== null && item.maxVariantStock !== undefined
        ? Math.max(0, item.maxVariantStock - otherVariantQty)
        : Number.POSITIVE_INFINITY;

      const maxByBatch = item.preferredBatchId && item.maxBatchQty !== null && item.maxBatchQty !== undefined
        ? item.maxBatchQty
        : Number.POSITIVE_INFINITY;

      const maxAllowed = Math.floor(Math.min(maxByVariant, maxByBatch));

      if (Number.isFinite(maxAllowed) && newQuantity > maxAllowed) {
        const scope = item.preferredBatchId ? 'in the selected batch' : 'in stock';
        toast.error(`Only ${maxAllowed} available ${scope}`);
        return;
      }

      dispatch(updateItemQuantity({ lineKey, quantity: newQuantity }));
    }
  };

  const handleUpdateOrder = async () => {
    if (currentOrder.isReturnOrder) {
      toast.error('Return orders cannot be edited. Please create a new return order.');
      return;
    }

    if (currentOrder.items.length === 0) {
      toast.error('Order must have at least one item');
      return;
    }

    try {
      const orderData = {
        staff_id: user.id,
        items: mapOrderItems(currentOrder.items),
        additional_charges: currentOrder.additionalCharges,
        customer_name: currentOrder.customerName,
        tender_cash: parseFloat(amountPaid) || currentOrder.total,
        discount_type: effectiveOrderDiscount.discountType,
        discount_value: effectiveOrderDiscount.discountValue,
        status: currentOrder.originalStatus || 'completed',
      };

      await dispatch(updateOrder({ orderId: currentOrder.id, orderData })).unwrap();
      toast.success(`Order #${currentOrder.id} updated successfully!`);

      dispatch(fetchItemVariants());
      dispatch(fetchActiveOrders());
      await refreshCashOnHand();
      dispatch(clearCurrentOrder());
      resetOrderUiState();
    } catch (error) {
      toast.error(`Failed to update order: ${error.message}`);
    }
  };

  const handlePlaceOrder = async () => {
    if (!hasOrderContent) {
      return;
    }

    if (requiresCashTender && (!amountPaid || change < 0)) {
      toast.error('Enter a valid tendered amount');
      return;
    }

    if (currentOrder.isReturnOrder && !currentOrder.originalOrderId) {
      toast.error('Return order must be linked to an original order');
      return;
    }

    try {
      let result;
      const tenderCash = requiresCashTender ? parseFloat(amountPaid || 0) : 0;

      if (currentOrder.id && !currentOrder.isReturnOrder) {
        const orderData = {
          staff_id: user.id,
          items: mapOrderItems(currentOrder.items),
          additional_charges: currentOrder.additionalCharges,
          customer_name: currentOrder.customerName,
          tender_cash: tenderCash,
          discount_type: effectiveOrderDiscount.discountType,
          discount_value: effectiveOrderDiscount.discountValue,
          status: 'completed',
        };

        result = await dispatch(updateOrder({ orderId: currentOrder.id, orderData })).unwrap();
        toast.success(`Order #${currentOrder.id} completed`);
      } else {
        const orderData = currentOrder.isReturnOrder
          ? {
              staff_id: user.id,
              items: mapOrderItems(currentOrder.items),
              return_items: mapReturnItems(currentOrder.returnedItems || []),
              additional_charges: currentOrder.additionalCharges,
              customer_name: currentOrder.customerName,
              tender_cash: tenderCash,
              discount_type: null,
              discount_value: 0,
              status: 'completed',
              is_return: true,
              original_order_id: currentOrder.originalOrderId,
              credit_reason: currentOrder.returnReason || null,
              credit_applied: Math.max(currentOrder.total, 0),
            }
          : {
              staff_id: user.id,
              items: mapOrderItems(currentOrder.items),
              additional_charges: currentOrder.additionalCharges,
              customer_name: currentOrder.customerName,
              tender_cash: tenderCash,
              discount_type: effectiveOrderDiscount.discountType,
              discount_value: effectiveOrderDiscount.discountValue,
              status: 'completed',
            };

        result = await dispatch(createOrder(orderData)).unwrap();
      }

      dispatch(fetchItemVariants());
      dispatch(fetchActiveOrders());
      await refreshCashOnHand();

      setCompletedOrder({
        ...currentOrder,
        id: result.id,
        barcode: result.barcode || currentOrder.barcode || null,
        total: currentOrder.total,
        discount_type: currentOrder.isReturnOrder ? null : effectiveOrderDiscount.discountType,
        discount_value: currentOrder.isReturnOrder ? 0 : effectiveOrderDiscount.discountValue,
        paymentMethod,
        amountPaid: tenderCash,
        tender_cash: tenderCash,
        cashier: user?.name || 'System',
        is_return: currentOrder.isReturnOrder,
      });

      if (!requiresCashTender) {
        setAmountPaid('0');
      }

      dispatch(clearCurrentOrder());
      setPaymentDialog(true);
    } catch (error) {
      toast.error(`Failed to complete order: ${error.message}`);
    }
  };

  const handleSetAsActive = async ({ customerName }) => {
    if (currentOrder.isReturnOrder) {
      toast.error('Return orders must be completed directly. Active mode is disabled.');
      return;
    }

    if (currentOrder.items.length === 0) {
      return;
    }

    const orderData = {
      staff_id: user.id,
      items: mapOrderItems(currentOrder.items),
      additional_charges: currentOrder.additionalCharges,
      customer_name: customerName || null,
      discount_type: effectiveOrderDiscount.discountType,
      discount_value: effectiveOrderDiscount.discountValue,
      status: 'active',
    };

    try {
      if (currentOrder.id) {
        await dispatch(updateOrder({ orderId: currentOrder.id, orderData })).unwrap();
        toast.success(`Order #${currentOrder.id} updated`);
      } else {
        const result = await dispatch(createOrder(orderData)).unwrap();
        toast.success(`Order #${result.id} set as active`);
      }

      dispatch(clearCurrentOrder());
      dispatch(fetchItemVariants());
      dispatch(fetchActiveOrders());
      resetOrderUiState();
      setSetActiveDialogOpen(false);
    } catch (error) {
      toast.error(`Failed to set order as active: ${error.message}`);
    }
  };

  const handlePaymentConfirm = async () => {
    try {
      const storeInfo = {
        name: 'Super Glow',
        address: '275/B/4 Galahitiyawa,Ganemulla.',
        phone: '071 160 0925 / 071 326 0021 (whatsapp)',
        receiptFooter: 'Thank you Come Again..!',
        currencySymbol: 'Rs',
      };

      const orderData = completedOrder || {
        ...currentOrder,
        id: Date.now(),
        paymentMethod,
        amountPaid: parseFloat(amountPaid) || currentOrder.total,
        cashier: user?.name || 'System',
        tender_cash: parseFloat(amountPaid) || currentOrder.total,
      };

      const savedPrinter = localStorage.getItem('selectedPrinter');
      let billResult;

      if (savedPrinter && window.require) {
        billResult = await htmlPrintService.printDirectThermal(orderData, storeInfo);
      } else {
        billResult = await htmlPrintService.printBillHTML(orderData, storeInfo);
      }

      if (billResult.success) {
        toast.success('Bill printed successfully!');
        dispatch(clearCurrentOrder());
        dispatch(fetchActiveOrders());
        setPaymentDialog(false);
        resetOrderUiState();
      } else {
        toast.error(billResult.message || 'Printer not connected. Please check printer.');
      }
    } catch (error) {
      toast.error(`Failed to print bill: ${error.message}`);
    }
  };

  const returnCreditLines = useMemo(() => {
    return (currentOrder.returnedItems || []).map((item, index) => {
      const qty = parseFloat(item.qty || 0) || 0;
      const unitPrice = parseFloat(item.unit_price || 0) || 0;
      return {
        key: `${item.item_variant_id || 'item'}-${index}`,
        title: `${item.item_name || 'Item'}${item.variant_name ? ` (${item.variant_name})` : ''}`,
        qty,
        unitPrice,
        lineTotal: qty * unitPrice,
      };
    });
  }, [currentOrder.returnedItems]);

  return (
    <>
      <Card sx={{ height: '93vh', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          {user?.role === 'cashier' && !activeShift && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>No Active Shift:</strong> You must open a cashier shift to process orders.
              </Typography>
            </Alert>
          )}

          {currentOrder.isEditing && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Editing Order #{currentOrder.id}</strong> - Make changes and click "Update Order" to save.
              </Typography>
            </Alert>
          )}

          {currentOrder.isReturnOrder && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Return Order Mode</strong>
                {currentOrder.originalOrderId ? ` - Original Order #${currentOrder.originalOrderId}` : ''}. Discounts are disabled.
              </Typography>
            </Alert>
          )}

          {currentOrder.id && (
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                Order #{currentOrder.id}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {currentOrder.customerName ? <Chip icon={<Person />} label={currentOrder.customerName} size="small" /> : null}
                {currentOrder.barcode ? <Chip label={currentOrder.barcode} size="small" variant="outlined" /> : null}
              </Box>
            </Box>
          )}

          <Box className="scrollbar-thin" sx={{ flexGrow: 1, bgcolor: '#f5f5f5', overflowY: 'auto' }}>
            {currentOrder.items.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'text.secondary' }}>
                <ShoppingCart sx={{ fontSize: 60, mb: 2, opacity: 0.5 }} />
                <Typography variant="body1">No new sale items</Typography>
              </Box>
            ) : (
              <List dense>
                {currentOrder.items.map((item, index) => (
                  <ListItem
                    key={item.lineKey || `${item.itemVariantId}-${index}`}
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
                          {item.discountSource && !currentOrder.isReturnOrder && (
                            <Chip
                              icon={<LocalOffer sx={{ fontSize: '0.6rem !important' }} />}
                              label={`${item.discountSource === 'item' ? 'Item' : item.discountSource === 'brand' ? 'Brand' : item.discountSource === 'manual' ? 'Manual' : 'Global'}: ${item.discountType === 'percentage' ? item.discountValue + '%' : 'Rs.' + item.discountValue}`}
                              size="small"
                              color={item.discountSource === 'item' ? 'error' : item.discountSource === 'brand' ? 'secondary' : item.discountSource === 'manual' ? 'info' : 'warning'}
                              sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-icon': { ml: '2px' } }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box>
                          {item.discountAmount > 0 && item.originalPrice && !currentOrder.isReturnOrder && (
                            <Typography variant="caption" sx={{ color: 'error.main', textDecoration: 'line-through', mr: 1 }}>
                              {formatPrice(item.originalPrice)}
                            </Typography>
                          )}
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                            Unit: {formatPrice(item.price)}{item.preferredBatchId ? ` | Batch #${item.preferredBatchId}` : ''}
                          </Typography>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <IconButton size="small" onClick={() => handleQuantityChange(item, item.quantity - 1)} sx={{ p: 0.5 }}>
                                <Remove fontSize="small" />
                              </IconButton>
                              <Typography variant="body2" fontWeight="bold" sx={{ fontSize: '0.8rem' }}>
                                {item.quantity}
                              </Typography>
                              <IconButton size="small" onClick={() => handleQuantityChange(item, item.quantity + 1)} sx={{ p: 0.5 }}>
                                <Add fontSize="small" />
                              </IconButton>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="body2" fontWeight="bold" sx={{ fontSize: '0.8rem' }}>
                                {formatPrice(item.total)}
                              </Typography>
                              <Tooltip title={currentOrder.isReturnOrder ? 'Disabled for return orders' : 'Edit Discount'}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="primary"
                                    disabled={currentOrder.isReturnOrder}
                                    onClick={() => {
                                      setEditDiscountItem(item.lineKey);
                                      setEditDiscountType(item.discountType || 'percentage');
                                      setEditDiscountValue(item.discountValue || '');
                                    }}
                                    sx={{ p: 0.5 }}
                                  >
                                    <EditIcon sx={{ fontSize: '0.9rem' }} />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title={currentOrder.isReturnOrder ? 'Disabled for return orders' : 'Reset to original price'}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="warning"
                                    disabled={currentOrder.isReturnOrder || !item.discountSource}
                                    onClick={() => dispatch(resetItemDiscount(item.lineKey))}
                                    sx={{ p: 0.5 }}
                                  >
                                    <Refresh sx={{ fontSize: '0.9rem' }} />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <IconButton size="small" color="error" onClick={() => dispatch(removeItemFromOrder(item.lineKey))} sx={{ p: 0.5 }}>
                                <Delete fontSize="small" />
                              </IconButton>
                            </Box>
                          </Box>

                          {!currentOrder.isReturnOrder && editDiscountItem === item.lineKey && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, p: 0.5, bgcolor: '#f0f4ff', borderRadius: 1 }}>
                              <Select
                                size="small"
                                value={editDiscountType}
                                onChange={(event) => setEditDiscountType(event.target.value)}
                                sx={{ minWidth: 80, height: 28, fontSize: '0.75rem' }}
                              >
                                <MenuItem value="percentage">%</MenuItem>
                                <MenuItem value="fixed">Rs.</MenuItem>
                              </Select>
                              <TextField
                                size="small"
                                type="text"
                                value={editDiscountValue}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  if (isValidDecimalInput(nextValue)) {
                                    setEditDiscountValue(nextValue);
                                  }
                                }}
                                placeholder="Value"
                                sx={{ width: 70 }}
                                inputProps={{ inputMode: 'decimal', style: { fontSize: '0.75rem', padding: '4px 8px' } }}
                              />
                              <Button
                                size="small"
                                variant="contained"
                                onClick={() => {
                                  dispatch(updateItemDiscount({
                                    lineKey: item.lineKey,
                                    discountType: editDiscountType,
                                    discountValue: parseFloat(editDiscountValue) || 0,
                                  }));
                                  setEditDiscountItem(null);
                                }}
                                sx={{ minWidth: 40, height: 28, fontSize: '0.7rem', p: 0 }}
                              >
                                OK
                              </Button>
                              <Button size="small" onClick={() => setEditDiscountItem(null)} sx={{ minWidth: 30, height: 28, fontSize: '0.7rem', p: 0 }}>
                                X
                              </Button>
                            </Box>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>

          {hasReturnItems && (
            <Box sx={{ mt: 1, p: 1, border: '1px dashed #d81b60', borderRadius: 1, bgcolor: '#fff4f8' }}>
              <Typography variant="subtitle2" sx={{ color: '#ad1457', mb: 0.5 }}>
                Returned Items Credit
              </Typography>
              {returnCreditLines.map((line) => (
                <Box key={line.key} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                  <Typography variant="caption">{line.title} x {line.qty}</Typography>
                  <Typography variant="caption" fontWeight="bold">- {formatPrice(line.lineTotal)}</Typography>
                </Box>
              ))}
              <Divider sx={{ my: 0.7 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" fontWeight="bold">Total Return Credit</Typography>
                <Typography variant="caption" fontWeight="bold">- {formatPrice(currentOrder.returnCreditTotal)}</Typography>
              </Box>

              <TextField
                size="small"
                label="Return Reason"
                value={currentOrder.returnReason || ''}
                onChange={(event) => dispatch(setReturnReason(event.target.value))}
                fullWidth
                sx={{ mt: 1 }}
              />
            </Box>
          )}

          {hasOrderContent && (
            <>
              <Divider sx={{ my: 2 }} />
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="body1">Sale Items</Typography>
                  <Typography variant="body1">{currentOrder.items.length}</Typography>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="body1">Subtotal</Typography>
                  <Typography variant="body1">
                    {formatPrice(
                      currentOrder.items.some((item) => item.discountAmount > 0) && !currentOrder.isReturnOrder
                        ? currentOrder.items.reduce((sum, item) => sum + (item.originalPrice || item.price) * item.quantity, 0)
                        : currentOrder.subtotal
                    )}
                  </Typography>
                </Box>

                {!currentOrder.isReturnOrder && currentOrder.items.some((item) => item.discountAmount > 0) && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="body2" color="error.main">Item Discounts</Typography>
                    <Typography variant="body2" color="error.main">
                      - {formatPrice(currentOrder.items.reduce((sum, item) => sum + (item.discountAmount || 0) * item.quantity, 0))}
                    </Typography>
                  </Box>
                )}

                {/*
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography variant="body1">Additional Charges</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2">Rs.</Typography>
                    <TextField
                      size="small"
                      type="number"
                      value={currentOrder.additionalCharges || ''}
                      onChange={(event) => dispatch(setAdditionalCharges(parseFloat(event.target.value) || 0))}
                      sx={{ width: 120 }}
                      inputProps={{ min: 0, step: 0.01 }}
                    />
                  </Box>
                </Box>
                */}

                {!currentOrder.isReturnOrder && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body1">Discount</Typography>
                      {globalDiscountSettings?.is_global_discount_active && (
                        <Chip icon={<LocalOffer sx={{ fontSize: '0.7rem !important' }} />} label="Global" size="small" color="warning" sx={{ height: 20, fontSize: '0.65rem' }} />
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Select
                        size="small"
                        value={discountType || 'fixed'}
                        onChange={(event) => {
                          setDiscountType(event.target.value);
                          setDiscountValue('');
                        }}
                        sx={{ width: 100 }}
                        disabled={!!globalDiscountSettings?.is_global_discount_active}
                      >
                        <MenuItem value="fixed">Fixed</MenuItem>
                        <MenuItem value="percent">Percent</MenuItem>
                      </Select>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {discountType === 'fixed' && <Typography variant="body2">Rs.</Typography>}
                        <TextField
                          size="small"
                          type="text"
                          value={discountValue || ''}
                          disabled={!!globalDiscountSettings?.is_global_discount_active}
                          onChange={(event) => {
                            const inputValue = event.target.value;
                            if (!isValidDecimalInput(inputValue)) {
                              return;
                            }

                            if (discountType === 'percent' && parseFloat(inputValue || 0) > 100) {
                              return;
                            }

                            setDiscountValue(inputValue);
                            if (inputValue) {
                              const numValue = parseFloat(inputValue);
                              if (Number.isFinite(numValue)) {
                                if (discountType === 'percent') {
                                  const discountAmount = Math.round((numValue / 100) * currentOrder.subtotal * 100) / 100;
                                  dispatch(setDiscount(discountAmount));
                                } else {
                                  dispatch(setDiscount(Math.round(numValue * 100) / 100));
                                }
                              }
                            } else {
                              dispatch(setDiscount(0));
                            }
                          }}
                          sx={{ width: 100 }}
                          inputProps={{ inputMode: 'decimal' }}
                        />
                        {discountType === 'percent' && <Typography variant="body2">%</Typography>}
                      </Box>
                    </Box>
                  </Box>
                )}

                {!currentOrder.isReturnOrder && effectiveOrderDiscount.blockedByMinimum && (
                  <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 2 }}>
                    Global discount applies only for orders above {formatPrice(effectiveOrderDiscount.minimumOrderAmount)}.
                  </Typography>
                )}

                {currentOrder.isReturnOrder && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="body1">Return Credit</Typography>
                    <Typography variant="body1" color="success.main">- {formatPrice(currentOrder.returnCreditTotal)}</Typography>
                  </Box>
                )}

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1976d2', padding: '12px 16px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                  <Typography variant="h6" fontWeight="bold" sx={{ color: '#ffffff' }}>Total</Typography>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: '#ffffff' }}>
                    {formatPrice(currentOrder.total)}
                  </Typography>
                </Box>

                <Divider sx={{ my: 2 }} />

                {requiresCashTender ? (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body1">Cash Tendered</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2">Rs.</Typography>
                      <TextField
                        size="small"
                        type="text"
                        value={amountPaid}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (isValidDecimalInput(value)) {
                            setAmountPaid(value);
                          }
                        }}
                        onBlur={(event) => {
                          if (event.target.value) {
                            const rounded = parseFloat(event.target.value).toFixed(2);
                            setAmountPaid(rounded);
                          }
                        }}
                        sx={{ width: 120 }}
                        inputProps={{ inputMode: 'decimal' }}
                      />
                    </Box>
                  </Box>
                ) : (
                  <Alert severity={currentOrder.total < 0 ? 'info' : 'success'} sx={{ mb: 2 }}>
                    {currentOrder.total < 0
                      ? `Refund to customer: ${formatPrice(Math.abs(currentOrder.total))}`
                      : 'No extra cash required for this order.'}
                  </Alert>
                )}

                {requiresCashTender && amountPaid && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: change >= 0 ? '#2e7d32' : '#d32f2f', padding: '12px 16px', borderRadius: '8px', mb: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                    <Typography variant="h6" fontWeight="bold" sx={{ color: '#ffffff' }}>Change</Typography>
                    <Typography variant="h5" fontWeight="bold" sx={{ color: '#ffffff' }}>
                      {formatPrice(change)}
                    </Typography>
                  </Box>
                )}

                <Divider sx={{ my: 1 }} />
              </Box>

              <Box sx={{ mt: 2 }}>
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
                      }}
                    >
                      Update Order
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={() => {
                        dispatch(clearCurrentOrder());
                        resetOrderUiState();
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
                      disabled={loading || !hasOrderContent || (requiresCashTender && (!amountPaid || change < 0))}
                      sx={{
                        mb: 1,
                        borderRadius: 2,
                        background: currentOrder.isReturnOrder
                          ? 'linear-gradient(45deg, #E91E63, #C2185B)'
                          : 'linear-gradient(45deg, #4ECDC4, #44A08D)',
                        fontSize: '1.1rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {currentOrder.isReturnOrder ? 'Place Return Order' : 'Place Order'}
                    </Button>

                    {!currentOrder.isReturnOrder && (
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
                        }}
                      >
                        Set as Active
                      </Button>
                    )}

                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={() => {
                        dispatch(clearCurrentOrder());
                        resetOrderUiState();
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

      <SetActiveDialog
        open={setActiveDialogOpen}
        onClose={() => setSetActiveDialogOpen(false)}
        onSave={handleSetAsActive}
        initialCustomerName={currentOrder.customerName}
      />

      <Dialog open={paymentDialog} onClose={() => setPaymentDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Payment Confirmation</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            {completedOrder?.is_return ? 'Return order placed successfully!' : 'Order placed successfully!'}
          </Alert>

          <Typography variant="body2" sx={{ mb: 1 }}>
            Order #{completedOrder?.id || '-'}
          </Typography>
          {completedOrder?.barcode && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              Barcode: {completedOrder.barcode}
            </Typography>
          )}
          <Typography variant="body2">
            Total: {formatPrice(dialogTotal)}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialog(false)}>Close</Button>
          <Button
            onClick={handlePaymentConfirm}
            variant="contained"
            startIcon={<Receipt />}
          >
            Print Bill & Complete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default OrderSummary;