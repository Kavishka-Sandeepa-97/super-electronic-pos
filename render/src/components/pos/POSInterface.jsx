import React, { useEffect, useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import useDebounce from '../../hooks/useDebounce';
import useBarcodeScanner from '../../hooks/useBarcodeScanner';
import {
  Box,
  Grid,
  Card,
  CardContent,
  CardMedia,
  Typography,
  Tooltip,
  Button,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  Badge,
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Snackbar,
  FormControlLabel,
  Checkbox,
  FormGroup,
  TablePagination,
} from '@mui/material';
import {
  Search,
  Add,
  ShoppingCart,
  Category,
  Person,
  CheckCircle,
  LocalOffer,
} from '@mui/icons-material';
import {
  fetchCategories,
  fetchItemVariants,
  setSelectedCategory,
  setSelectedBrand,
  setSelectedGender,
  resetFilters,
  setSearchTerm,
  filterItems
} from '../../store/slices/inventorySlice';
import { addItemToOrder, fetchActiveOrders } from '../../store/slices/orderSlice';
import { openModal } from '../../store/slices/uiSlice';
import OrderSummary from './OrderSummary';
import ActiveOrdersDialog from './ActiveOrdersDialog';
import BarcodeNotFoundDialog from './BarcodeNotFoundDialog';
import OrderHistoryDialog from './OrderHistoryDialog';
import ReturnOrderDialog from './ReturnOrderDialog';
import BatchSelectionDialog from './BatchSelectionDialog';
import CategoryMenu from './CategoryMenu';
import BrandMenu from './BrandMenu';
import { toast } from 'react-toastify';
import api from '../../services/api';

const POSInterface = () => {
  const dispatch = useDispatch();
  const {
    categories,
    itemVariants,
    filteredItems,
    selectedCategory,
    selectedBrand,
    selectedGender,
    searchTerm,
    loading,
    error
  } = useSelector((state) => state.inventory);

  const { activeOrders, currentOrder } = useSelector((state) => state.order);
  const { modals } = useSelector((state) => state.ui);

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [posPage, setPosPage] = useState(0);
  const [posRowsPerPage, setPosRowsPerPage] = useState(24);
  const [activeOrdersOpen, setActiveOrdersOpen] = useState(false);
  
  // Barcode scanner states
  const [barcodeNotFoundOpen, setBarcodeNotFoundOpen] = useState(false);
  const [failedBarcode, setFailedBarcode] = useState('');
  const [successMessage, setSuccessMessage] = useState(null);
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  // Batch selection dialog state
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchDialogData, setBatchDialogData] = useState(null); // { itemVariant, batches }

  // Global discount settings
  const [globalDiscountSettings, setGlobalDiscountSettings] = useState(null);

  // Setup barcode scanner hook
  const { resetBarcode } = useBarcodeScanner(
    (barcode) => handleBarcodeScanned(barcode)
  );

  // Helper: get unique sell prices from available batches
  const getUniquePrices = (batches) => {
    const prices = new Set(batches.map((b) => parseFloat(b.sell_price).toFixed(2)));
    return [...prices];
  };

  // Helper: add item directly (single price or after batch selected)
  const addItemWithPrice = useCallback((itemVariant, sellPrice, barcode, preferredBatchId = null, batchRemainingQty = null) => {
    const variantId = itemVariant.id;
    const totalStock = parseFloat(itemVariant.total_stock);
    const safeTotalStock = Number.isFinite(totalStock) ? totalStock : null;

    const variantQtyInOrder = (currentOrder.items || [])
      .filter((item) => item.itemVariantId === variantId)
      .reduce((sum, item) => sum + (parseFloat(item.quantity || 0) || 0), 0);

    if (safeTotalStock !== null && variantQtyInOrder >= safeTotalStock) {
      toast.error(`Only ${safeTotalStock} units available in stock`);
      return;
    }

    const normalizedPrice = (parseFloat(sellPrice) || 0).toFixed(2);
    const matchingLine = (currentOrder.items || []).find((item) =>
      item.itemVariantId === variantId
      && (item.preferredBatchId || null) === (preferredBatchId || null)
      && (parseFloat(item.price || 0).toFixed(2) === normalizedPrice)
    );

    const parsedBatchLimit = parseFloat(batchRemainingQty);
    const hasBatchLimit = preferredBatchId && Number.isFinite(parsedBatchLimit);
    if (hasBatchLimit) {
      const currentLineQty = matchingLine ? (parseFloat(matchingLine.quantity || 0) || 0) : 0;
      if (currentLineQty >= parsedBatchLimit) {
        toast.error(`Selected batch has only ${parsedBatchLimit} units`);
        return;
      }
    }

    dispatch(addItemToOrder({
      itemVariant: { ...itemVariant, selling_price: sellPrice, sellingPrice: sellPrice },
      quantity: 1,
      globalDiscountSettings,
      preferredBatchId,
      batchRemainingQty: hasBatchLimit ? parsedBatchLimit : null,
    }));
    setSuccessMessage({
      name: itemVariant.item_name,
      variant: itemVariant.variant_name,
      barcode: barcode || itemVariant.barcode || '',
    });
    toast.success(`${itemVariant.item_name} added to order`);
    setTimeout(() => setSuccessMessage(null), 2000);
  }, [dispatch, globalDiscountSettings, currentOrder.items]);

  // Handle batch dialog confirm
  const handleBatchConfirm = useCallback((selectedBatch, _reason) => {
    if (!batchDialogData) return;
    const { itemVariant, barcode } = batchDialogData;
    addItemWithPrice(
      itemVariant,
      parseFloat(selectedBatch.sell_price),
      barcode,
      selectedBatch.id,
      parseFloat(selectedBatch.remaining_qty || 0)
    );
    setBatchDialogOpen(false);
    setBatchDialogData(null);
  }, [batchDialogData, addItemWithPrice]);

  // Handle barcode scan
  const handleBarcodeScanned = useCallback(async (barcode) => {
    if (!barcode) return;

    try {
      const response = await fetch(`http://localhost:3001/api/item-variants/barcode/${encodeURIComponent(barcode)}`);

      if (!response.ok) {
        setFailedBarcode(barcode);
        setBarcodeNotFoundOpen(true);
        toast.error(`Product not found for barcode: ${barcode}`);
        return;
      }

      const itemVariant = await response.json();
      const batches = itemVariant.available_batches || [];

      // Check if item has stock
      if (batches.length === 0) {
        toast.error(`${itemVariant.item_name} is out of stock`);
        return;
      }

      const uniquePrices = getUniquePrices(batches);

      if (uniquePrices.length > 1) {
        // Multiple prices — let cashier select
        setBatchDialogData({ itemVariant, batches, barcode });
        setBatchDialogOpen(true);
      } else {
        // Single price — use FIFO batch price
        addItemWithPrice(itemVariant, parseFloat(batches[0].sell_price), barcode);
      }

    } catch (error) {
      setFailedBarcode(barcode);
      setBarcodeNotFoundOpen(true);
      toast.error(`Error scanning barcode: ${error.message}`);
    }
  }, [addItemWithPrice]);

  useEffect(() => {
    dispatch(fetchCategories());
    dispatch(fetchItemVariants());
    dispatch(fetchActiveOrders()); // Fetch active orders for badge count

    // Fetch global discount settings
    api.globalDiscount.get().then(settings => {
      setGlobalDiscountSettings(settings);
    }).catch(err => console.error('Failed to load global discount settings:', err));

    // Cleanup function
    return () => {
      // Any cleanup needed when component unmounts
    };
  }, [dispatch]);

  useEffect(() => {
    dispatch(setSearchTerm(debouncedSearch));
    dispatch(filterItems());
    setPosPage(0);

    // Cleanup function
    return () => {
      // Cleanup on unmount or when dependencies change
    };
  }, [debouncedSearch, selectedCategory, selectedBrand, selectedGender, dispatch]);

  const brands = React.useMemo(() => {
    const brandSet = new Set();
    (itemVariants || []).forEach(item => {
      if (item?.brand_name) brandSet.add(item.brand_name);
    });
    return Array.from(brandSet).sort((a, b) => a.localeCompare(b));
  }, [itemVariants]);

  const handleAddToOrder = useCallback(async (itemVariant) => {
    try {
      // Fetch fresh batch data for this item variant
      const response = await fetch(`http://localhost:3001/api/item-variants/${itemVariant.id}`);
      if (!response.ok) {
        // Fallback: add directly with existing price
        addItemWithPrice(itemVariant, parseFloat(itemVariant.selling_price), null);
        return;
      }
      const freshData = await response.json();
      const batches = freshData.available_batches || [];

      if (batches.length === 0) {
        toast.error(`${itemVariant.item_name} is out of stock`);
        return;
      }

      const uniquePrices = getUniquePrices(batches);

      if (uniquePrices.length > 1) {
        setBatchDialogData({ itemVariant: freshData, batches, barcode: null });
        setBatchDialogOpen(true);
      } else {
        addItemWithPrice(freshData, parseFloat(batches[0].sell_price), null);
      }
    } catch (error) {
      // Fallback on network error
      addItemWithPrice(itemVariant, parseFloat(itemVariant.selling_price), null);
    }
  }, [addItemWithPrice]);

  const getStockStatus = (stock) => {
    if (stock <= 0) return { label: 'Out of Stock', color: 'error' };
    if (stock <= 10) return { label: 'Low Stock', color: 'warning' };
    return { label: 'In Stock', color: 'success' };
  };

  const formatPrice = (price) => {
    // Parse the price and check if it's a valid number
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) {
      console.warn('Invalid price value:', price);
      return 'Rs. 0.00'; // Return a default formatted price for display
    }
    return `Rs. ${numPrice.toFixed(2)}`;
  };

  if (loading && !itemVariants.length) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={60} />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}

      {/* Success notification */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={2000}
        onClose={() => setSuccessMessage(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: '#4CAF50',
            color: 'white',
            p: 2,
            borderRadius: 1,
            boxShadow: 3,
          }}
        >
          <CheckCircle />
          <Box>
            <Typography variant="subtitle2" fontWeight="bold">
              {successMessage?.name}
            </Typography>
            <Typography variant="caption">
              {successMessage?.variant} - {successMessage?.barcode}
            </Typography>
          </Box>
        </Box>
      </Snackbar>

          {/* Current order indicator moved into OrderSummary */}

      {/* Main Content */}
      <Grid container sx={{ flexGrow: 1 }}>

        {/* Content Area */}
        <Grid item xs={8} sx={{ display: 'flex', flexDirection: 'column' }}>
          
          {/* Search Bar + Active Orders Button (button on right) */}
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ flexGrow: 1 }}>
              <TextField
                fullWidth
                placeholder="Search items... (or use barcode scanner)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 25,
                  },
                }}
              />
            </Box>

            {(activeOrders || []).length > 0 ? (
              <Badge
                badgeContent={activeOrders.length}
                color="error"
                overlap="circular"
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                sx={{
                  '& .MuiBadge-badge': {
                    fontSize: '0.7rem',
                    height: 25,
                    minWidth: 25,
                    borderRadius: '50%',
                    transform: 'translate(16px, -16px)',
                    padding: 0,
                  }
                }}
              >
                <Button
                  variant="contained"
                  onClick={() => setActiveOrdersOpen(true)}
                  sx={{
                    whiteSpace: 'nowrap',
                    background: 'black',
                    color: 'white',
                    '&:hover': { background: '#111' },
                    height: 40,
                    px: 4,
                    borderRadius: 15,
                  }}
                >
                  Active Orders
                </Button>
              </Badge>
            ) : (
              <Button
                variant="contained"
                onClick={() => setActiveOrdersOpen(true)}
                sx={{
                  whiteSpace: 'nowrap',
                  background: 'black',
                  color: 'white',
                  '&:hover': { background: '#111' },
                  height: 40,
                  px: 4,
                  borderRadius: 15,
                }}
              >
                Active Orders
              </Button>
            )}

            <Button
              variant="contained"
              onClick={() => setOrderHistoryOpen(true)}
              sx={{
                whiteSpace: 'nowrap',
                background: '#2196F3',
                color: 'white',
                '&:hover': { background: '#1976D2' },
                height: 40,
                px: 4,
                borderRadius: 15,
              }}
            >
              Order History
            </Button>

            <Button
              variant="contained"
              onClick={() => setReturnDialogOpen(true)}
              sx={{
                whiteSpace: 'nowrap',
                background: '#E91E63',
                color: 'white',
                '&:hover': { background: '#C2185B' },
                height: 40,
                px: 4,
                borderRadius: 15,
              }}
            >
              Return
            </Button>
          </Box>

          {/* Category + Brand + Gender Filters */}
          <Box sx={{ px: 2, pb: 2, display: 'flex', flexWrap: 'nowrap', gap: 1.5, alignItems: 'center' }}>
            <CategoryMenu
              categories={categories}
              selectedCategory={selectedCategory}
              onCategorySelect={(category) => {
                dispatch(setSelectedCategory(category?.id || null));
              }}
              containerSx={{ p: 0, borderBottom: 'none' }}
            />
            <BrandMenu
              brands={brands}
              selectedBrand={selectedBrand}
              onBrandSelect={(brand) => dispatch(setSelectedBrand(brand))}
            />

            <FormGroup row sx={{ ml: 0.5, gap: 0.5, alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedGender === 'ALL'}
                    onChange={() => dispatch(setSelectedGender('ALL'))}
                    size="small"
                    sx={{ p: 0.5 }}
                  />
                }
                label="All"
                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedGender === 'MEN'}
                    onChange={() => dispatch(setSelectedGender('MEN'))}
                    size="small"
                    sx={{ p: 0.5 }}
                  />
                }
                label="Men"
                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedGender === 'WOMEN'}
                    onChange={() => dispatch(setSelectedGender('WOMEN'))}
                    size="small"
                    sx={{ p: 0.5 }}
                  />
                }
                label="Women"
                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedGender === 'UNISEX'}
                    onChange={() => dispatch(setSelectedGender('UNISEX'))}
                    size="small"
                    sx={{ p: 0.5 }}
                  />
                }
                label="Unisex"
                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
              />
            </FormGroup>

            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                dispatch(resetFilters());
                setSearchInput('');
              }}
              sx={{
                height: 32,
                borderRadius: 12,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.8rem',
              }}
            >
              Reset Filters
            </Button>
          </Box>

          {/* Items Grid */}
          <Box className="scrollbar-thin" sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
            <Grid container spacing={2}>
              {(filteredItems || []).slice(posPage * posRowsPerPage, posPage * posRowsPerPage + posRowsPerPage).map((item) => {
                if (!item) return null;
                const stockStatus = getStockStatus(item.total_stock || 0);
                const isOutOfStock = (item.total_stock || 0) <= 0;
                return (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={item.id}>
                    <Card
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          boxShadow: '0 8px 25px rgba(0,0,0,0.15)',
                        },
                        border: isOutOfStock ? '2px solid #f44336' : 'none',
                        opacity: isOutOfStock ? 0.6 : 1,
                      }}
                      onClick={() => !isOutOfStock && handleAddToOrder(item)}
                    >
                      {item.image ? (
                        <CardMedia
                          component="img"
                          loading="lazy"
                          image={item.image.startsWith('data:image') ? item.image : `http://localhost:3001/uploads/${item.image.replace(/\\/g, '/').split('/').pop()}`}
                          alt={item.item_name}
                          sx={{
                            height: 120,
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <CardMedia
                          component="div"
                          sx={{
                            height: 120,
                            background: 'linear-gradient(45deg, #667eea, #764ba2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: '2rem',
                          }}
                        >
                          <Category />
                        </CardMedia>
                      )}

                      <CardContent sx={{ flexGrow: 1, p: 2 }}>
                        <Tooltip title={item.item_name || 'Unknown Item'} arrow>
                          <Typography variant="h6" fontWeight="bold" gutterBottom noWrap sx={{ maxWidth: '100%' }}>
                            {item.item_name || 'Unknown Item'}
                          </Typography>
                        </Tooltip>

                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          {item.variant_name || 'Default Variant'}
                        </Typography>

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Box
                            sx={{
                              backgroundColor: '#2e7d32',
                              color: '#ffffff',
                              padding: '6px 12px',
                              borderRadius: '8px',
                              fontWeight: 'bold',
                              fontSize: '1.1rem',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            }}
                          >
                            {formatPrice(item.selling_price || 0)}
                          </Box>
                          {!globalDiscountSettings?.is_global_discount_active && (item.is_discount_active || item.brand_discount_active) && (
                            <Tooltip title={
                              item.is_discount_active 
                                ? `Item Discount: ${item.discount_type === 'percentage' ? item.discount_value + '%' : 'Rs.' + item.discount_value}`
                                : `Brand Discount: ${item.brand_discount_type === 'percentage' ? item.brand_discount_value + '%' : 'Rs.' + item.brand_discount_value}`
                            }>
                              <Chip
                                icon={<LocalOffer sx={{ fontSize: '0.7rem !important' }} />}
                                label={
                                  item.is_discount_active 
                                    ? (item.discount_type === 'percentage' ? `${item.discount_value}%` : `Rs.${item.discount_value}`)
                                    : (item.brand_discount_type === 'percentage' ? `${item.brand_discount_value}%` : `Rs.${item.brand_discount_value}`)
                                }
                                size="small"
                                color={item.is_discount_active ? 'error' : 'secondary'}
                                sx={{ height: 22, fontSize: '0.7rem' }}
                              />
                            </Tooltip>
                          )}

                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            Stock: {(item.total_stock || 0)} units
                          </Typography>

                          <Box>
                            <Chip
                              label={stockStatus.label}
                              color={stockStatus.color}
                              size="small"
                              variant="outlined"
                              sx={{ mt: 0.5 }}
                            />
                          </Box>
                        </Box>


                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>

            {filteredItems.length === 0 && !loading && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '50vh',
                  color: 'text.secondary',
                }}
              >
                <ShoppingCart sx={{ fontSize: 80, mb: 2, opacity: 0.5 }} />
                <Typography variant="h6" gutterBottom>
                  No items found
                </Typography>
                <Typography variant="body2">
                  Try adjusting your search or category filter
                </Typography>
              </Box>
            )}
            {filteredItems.length > 0 && (
              <TablePagination
                component="div"
                count={filteredItems.length}
                page={posPage}
                onPageChange={(_, newPage) => { setPosPage(newPage); }}
                rowsPerPage={posRowsPerPage}
                onRowsPerPageChange={(e) => { setPosRowsPerPage(parseInt(e.target.value, 10)); setPosPage(0); }}
                rowsPerPageOptions={[12, 24, 48]}
                labelRowsPerPage="Per page:"
                sx={{ borderTop: '1px solid', borderColor: 'divider', mt: 1 }}
              />
            )}
          </Box>
        </Grid>

        {/* Order Details */}
        <Grid item xs={4} sx={{ borderLeft: '1px solid #e0e0e0', p: 2, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
          <OrderSummary />
        </Grid>
      </Grid>

      {/* Active Orders dialog */}
      <ActiveOrdersDialog
        open={activeOrdersOpen}
        onClose={() => setActiveOrdersOpen(false)}
      />

      {/* Order History dialog */}
      <OrderHistoryDialog
        open={orderHistoryOpen}
        onClose={() => setOrderHistoryOpen(false)}
      />

      <ReturnOrderDialog
        open={returnDialogOpen}
        onClose={() => setReturnDialogOpen(false)}
      />

      {/* Barcode Not Found Dialog */}
      <BarcodeNotFoundDialog
        open={barcodeNotFoundOpen}
        barcode={failedBarcode}
        onClose={() => setBarcodeNotFoundOpen(false)}
      />

      {/* Batch / Price Selection Dialog */}
      <BatchSelectionDialog
        open={batchDialogOpen}
        onClose={() => { setBatchDialogOpen(false); setBatchDialogData(null); }}
        onConfirm={handleBatchConfirm}
        itemName={batchDialogData?.itemVariant?.item_name || ''}
        variantName={batchDialogData?.itemVariant?.variant_name || ''}
        batches={batchDialogData?.batches || []}
      />

      {/* Order modals are handled elsewhere */}
    </Box>
  );
};

export default POSInterface;