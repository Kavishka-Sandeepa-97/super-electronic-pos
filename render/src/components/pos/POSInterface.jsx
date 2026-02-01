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
  Tabs,
  Tab,
  Badge,
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Snackbar,
} from '@mui/material';
import {
  Search,
  Add,
  ShoppingCart,
  LocalDining,
  LocalBar,
  Coffee,
  Cake,
  Fastfood,
  SmokeFree,
  Category,
  Restaurant,
  Person,
  CheckCircle,
} from '@mui/icons-material';
import { fetchCategories, fetchItemVariants, setSelectedCategory, setSearchTerm, filterItems } from '../../store/slices/inventorySlice';
import { addItemToOrder, fetchActiveOrders } from '../../store/slices/orderSlice';
import { openModal } from '../../store/slices/uiSlice';
import OrderSummary from './OrderSummary';
import ActiveOrdersDialog from './ActiveOrdersDialog';
import BarcodeNotFoundDialog from './BarcodeNotFoundDialog';
import OrderHistoryDialog from './OrderHistoryDialog';
import { toast } from 'react-toastify';

const categoryIcons = {
  'liquor': <LocalBar />,
  'beverages': <Coffee />,
  'hot meals': <LocalDining />,
  'desserts': <Cake />,
  'snacks': <Fastfood />,
  'tobacco': <SmokeFree />,
  'other': <Category />,
};

// Function to get icon regardless of case
const getCategoryIcon = (categoryName) => {
  if (!categoryName) return <Category />;
  const lowerCaseName = categoryName.toLowerCase();
  return categoryIcons[lowerCaseName] || <Category />;
};

const categoryColors = {
  'liquor': '#FF6B6B',
  'beverages': '#4ECDC4',
  'hot meals': '#45B7D1',
  'desserts': '#F7DC6F',
  'snacks': '#BB8FCE',
  'tobacco': '#85929E',
  'other': '#58D68D',
};

// Function to get color regardless of case
const getCategoryColor = (categoryName) => {
  if (!categoryName) return '#666';
  const lowerCaseName = categoryName.toLowerCase();
  return categoryColors[lowerCaseName] || '#666';
};

const POSInterface = () => {
  const dispatch = useDispatch();
  const {
    categories,
    itemVariants,
    filteredItems,
    selectedCategory,
    searchTerm,
    loading,
    error
  } = useSelector((state) => state.inventory);

  const { currentOrder, activeOrders } = useSelector((state) => state.order);
  const { modals } = useSelector((state) => state.ui);

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [activeOrdersOpen, setActiveOrdersOpen] = useState(false);
  
  // Barcode scanner states
  const [barcodeNotFoundOpen, setBarcodeNotFoundOpen] = useState(false);
  const [failedBarcode, setFailedBarcode] = useState('');
  const [successMessage, setSuccessMessage] = useState(null);
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);

  // Setup barcode scanner hook
  const { resetBarcode } = useBarcodeScanner(
    (barcode) => handleBarcodeScanned(barcode)
  );

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

      // Check if item has stock (only if quantity managed)
      if (itemVariant.is_qty_managed && itemVariant.total_stock <= 0) {
        toast.error(`${itemVariant.item_name} is out of stock`);
        return;
      }

      // Add item to order
      dispatch(addItemToOrder({
        itemVariant: {
          ...itemVariant,
          sellingPrice: parseFloat(itemVariant.selling_price)
        },
        quantity: 1
      }));
      
      // Show success notification
      setSuccessMessage({
        name: itemVariant.item_name,
        variant: itemVariant.variant_name,
        barcode: barcode
      });
      toast.success(`${itemVariant.item_name} added to order`);

      // Auto-hide success message after 2 seconds
      setTimeout(() => setSuccessMessage(null), 2000);

    } catch (error) {
      setFailedBarcode(barcode);
      setBarcodeNotFoundOpen(true);
      toast.error(`Error scanning barcode: ${error.message}`);
    }
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchCategories());
    dispatch(fetchItemVariants());
    dispatch(fetchActiveOrders()); // Fetch active orders for badge count

    // Cleanup function
    return () => {
      // Any cleanup needed when component unmounts
    };
  }, [dispatch]);

  useEffect(() => {
    dispatch(setSearchTerm(debouncedSearch));
    dispatch(filterItems());

    // Cleanup function
    return () => {
      // Cleanup on unmount or when dependencies change
    };
  }, [debouncedSearch, selectedCategory, dispatch]);

  const handleCategoryChange = useCallback((event, newValue) => {
    dispatch(setSelectedCategory(newValue));
  }, [dispatch]);

  const handleAddToOrder = useCallback((itemVariant) => {
    // Ensure the item has a valid selling_price before adding to order
    const validItem = {
      ...itemVariant,
      // Make sure selling_price is a valid number
      sellingPrice: parseFloat(itemVariant.selling_price)
    };

    dispatch(addItemToOrder({ itemVariant: validItem, quantity: 1 }));
  }, [dispatch]);

  const getStockStatus = (stock, isQtyManaged) => {
    if (!isQtyManaged) return { label: 'Available', color: 'success' };
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

  // Prepare categories for tabs
  const allCategories = [
    { id: 'all', name: 'All', icon: <Category /> },
    ...(categories || []).map(cat => ({
      id: (cat?.name || '').toLowerCase(),
      name: cat?.name || 'Unknown',
      icon: getCategoryIcon(cat?.name)
    }))
  ];

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
          </Box>

          {/* Category Tabs */}
          <Box sx={{ px: 2 }}>
            <Tabs
              value={selectedCategory}
              onChange={handleCategoryChange}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                '& .MuiTab-root': {
                  minHeight: 40,
                  borderRadius: 20,
                  margin: 0.5,
                  '&.Mui-selected': {
                    background: 'linear-gradient(45deg, #667eea, #764ba2)',
                    color: 'white',
                  },
                },
              }}
            >
              {allCategories.map((category) => (
                <Tab
                  key={category.id}
                  value={category.id}
                  icon={category.icon}
                  label={category.name}
                  iconPosition="start"
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    color: getCategoryColor(category.name),
                  }}
                />
              ))}
            </Tabs>
          </Box>

          {/* Items Grid */}
          <Box className="scrollbar-thin" sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
            <Grid container spacing={2}>
              {(filteredItems || []).map((item) => {
                if (!item) return null;
                const stockStatus = getStockStatus(item.total_stock || 0, item.is_qty_managed);
                const isOutOfStock = item.is_qty_managed && (item.total_stock || 0) <= 0;
                return (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={item.id || Math.random()}>
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
                            background: `linear-gradient(45deg, ${getCategoryColor(item.category_name) || '#667eea'}, ${getCategoryColor(item.category_name) || '#764ba2'})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: '2rem',
                          }}
                        >
                          {getCategoryIcon(item.category_name) || <LocalDining />}
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

                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            Stock: {item.is_qty_managed ? (item.total_stock || 0) + ' units' : 'Not managed'}
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

      {/* Barcode Not Found Dialog */}
      <BarcodeNotFoundDialog
        open={barcodeNotFoundOpen}
        barcode={failedBarcode}
        onClose={() => setBarcodeNotFoundOpen(false)}
      />

      {/* Order modals are handled elsewhere */}
    </Box>
  );
};

export default POSInterface;