import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import imageCompression from 'browser-image-compression';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Chip,
  IconButton,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  InputAdornment,
  Fab,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Alert,
  CircularProgress,
  Avatar,
  Badge,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  CardMedia,
  Autocomplete,
  Radio,
  Menu,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Inventory as InventoryIcon,
  Warning as WarningIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Save as SaveIcon,
  Category as CategoryIcon,
  Label as LabelIcon,
  PhotoCamera as PhotoCameraIcon,
  QrCodeScanner as QrCodeScannerIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  History as HistoryIcon,
  Refresh as RefreshIcon,
  ListAlt as ListAltIcon,
  ChevronRight as ChevronRightIcon,
  ArrowDropDown as ArrowDropDownIcon,
} from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { fetchCategories, fetchVariants, fetchItemVariants } from '../../store/slices/inventorySlice';
import api from '../../services/api';
import SellPriceHistory from '../SellPriceHistory';
import CategoryManagementMenu from './CategoryManagementMenu';
import BrandManagementMenu from './BrandManagementMenu';
// import AddItemWithVariants from './AddItemWithVariants';

const getCategoryIcon = (categoryName) => {
  const iconMap = {
    'Desserts': '🍰',
    'Snacks': '🍿',
    'Tobacco': '🚬',
    'Other': '📦'
  };
  return iconMap[categoryName] || '📦';
};

// Helper function to flatten categories for display
const flattenCategories = (categories, prefix = '') => {
  let result = [];
  categories.forEach(cat => {
    const displayName = prefix ? `${prefix} > ${cat.name}` : cat.name;
    result.push({ ...cat, displayName });
    if (cat.subcategories && cat.subcategories.length > 0) {
      result = result.concat(flattenCategories(cat.subcategories, displayName));
    }
  });
  return result;
};

const ItemManagement = React.memo(({
  categories,
  itemVariants,
  itemSearchTerm,
  setItemSearchTerm,
  loading
}) => {
  const dispatch = useDispatch();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [savingItem, setSavingItem] = useState(false);
  const [brands, setBrands] = useState([]);
  const [itemFormData, setItemFormData] = useState({
    name: '',
    category_id: '',
    category_name: '',
    brand_id: '',
    gender: 'UNISEX',
    image: null,
    imagePreview: null,
  });
  const [formFieldTouched, setFormFieldTouched] = useState({
    name: false,
    category: false,
  });
  const itemFileInputRef = useRef(null);

  // Category menu states
  const [categoryAnchorEl, setCategoryAnchorEl] = useState(null);
  const [level1Anchor, setLevel1Anchor] = useState(null);
  const [level1Category, setLevel1Category] = useState(null);
  const [level2Anchor, setLevel2Anchor] = useState(null);
  const [level2Category, setLevel2Category] = useState(null);
  const [activePath, setActivePath] = useState([]);

  // Fetch brands
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const data = await api.brands.getAll();
        setBrands(data);
      } catch (error) {
        console.error('Error fetching brands:', error);
      }
    };
    fetchBrands();
  }, []);

  const handleAddNewItem = () => {
    setEditingItem(null);
    setItemFormData({
      name: '',
      category_id: '',
      category_name: '',
      brand_id: '',
      gender: 'UNISEX',
      image: null,
      imagePreview: null,
    });
    setFormFieldTouched({ name: false, category: false });
    setDialogOpen(true);
  };

  const handleEditItemInline = (item) => {
    setEditingItem(item);
    setItemFormData({
      name: item.item_name || item.name || '',
      category_id: item.category_id || '',
      category_name: item.category_name || item.category || '',
      brand_id: item.brand_id || '',
      gender: item.gender || 'UNISEX',
      image: null,
      imagePreview: item.image || null,
    });
    setFormFieldTouched({ name: false, category: false });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingItem(null);
    setItemFormData({
      name: '',
      category_id: '',
      category_name: '',
      brand_id: '',
      gender: 'UNISEX',
      image: null,
      imagePreview: null,
    });
    setFormFieldTouched({ name: false, category: false });
    closeCategoryMenus();
  };

  // Category menu handlers
  const handleCategoryButtonClick = (event) => {
    setCategoryAnchorEl(event.currentTarget);
  };

  const closeCategoryMenus = () => {
    setCategoryAnchorEl(null);
    setLevel1Anchor(null);
    setLevel1Category(null);
    setLevel2Anchor(null);
    setLevel2Category(null);
    setActivePath([]);
  };

  const handleCategorySelect = (category) => {
    setItemFormData(prev => ({
      ...prev,
      category_id: category.id,
      category_name: category.name,
    }));
    closeCategoryMenus();
  };

  const openLevel1 = useCallback((event, category) => {
    setLevel2Anchor(null);
    setLevel2Category(null);
    setLevel1Anchor(event.currentTarget);
    setLevel1Category(category);
    setActivePath([category.id]);
  }, []);

  const openLevel2 = useCallback((event, category) => {
    setLevel2Anchor(event.currentTarget);
    setLevel2Category(category);
    setActivePath(prev => [prev[0], category.id]);
  }, []);

  const isInActivePath = (categoryId) => activePath.includes(categoryId);

  const handleImageUploadInline = async (event) => {
    const file = event.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select a valid image file');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size should be less than 5MB');
        return;
      }

      try {
        const options = {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          quality: 0.85,
          useWebWorker: true
        };
        
        const compressedFile = await imageCompression(file, options);
        
        const reader = new FileReader();
        reader.onload = (e) => {
          setItemFormData(prev => ({
            ...prev,
            image: compressedFile,
            imagePreview: e.target.result
          }));
        };
        reader.readAsDataURL(compressedFile);
      } catch (error) {
        console.error('Error compressing image:', error);
        toast.error('Failed to compress image');
      }
    }
  };

  const removeImageInline = () => {
    setItemFormData(prev => ({
      ...prev,
      image: null,
      imagePreview: null
    }));
    if (itemFileInputRef.current) {
      itemFileInputRef.current.value = '';
    }
  };

  const handleSaveItemInline = async () => {
    if (!itemFormData.name.trim()) {
      toast.error('Item name is required.');
      setFormFieldTouched(prev => ({ ...prev, name: true }));
      return;
    }

    if (!itemFormData.category_id) {
      toast.error('Category selection is required.');
      setFormFieldTouched(prev => ({ ...prev, category: true }));
      return;
    }

    setSavingItem(true);
    try {
      const itemData = {
        name: itemFormData.name,
        category_id: itemFormData.category_id,
        brand_id: itemFormData.brand_id || null,
        gender: itemFormData.gender,
        image: itemFormData.imagePreview,
      };

      if (editingItem) {
        const itemId = editingItem.item_id_ref || editingItem.id;
        if (!itemId) {
          throw new Error('Item ID not found');
        }
        await api.items.update(itemId, itemData);
        toast.success('Item updated successfully');
      } else {
        await api.items.create(itemData);
        toast.success('Item added successfully');
      }

      dispatch(fetchItemVariants());
      handleCloseDialog();
    } catch (error) {
      console.error('Error saving item:', error);
      toast.error('Error saving item: ' + error.message);
    } finally {
      setSavingItem(false);
    }
  };

  const handleDeleteItemInline = async (item) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      try {
        const itemId = item.item_id_ref || item.id;
        await api.items.delete(itemId);
        toast.success('Item deleted successfully');
        dispatch(fetchItemVariants());
      } catch (error) {
        toast.error('Failed to delete item: ' + error.message);
      }
    }
  };

  const handleRefresh = () => {
    dispatch(fetchItemVariants());
    toast.success('Items refreshed');
  };

  // Filter items based on search term FIRST (using itemSearchTerm for ITEM tab)
  // Memoize to prevent unnecessary re-renders that cause focus loss
  const filteredUniqueItems = React.useMemo(() => {
    const filteredItemVariants = itemVariants.filter(item => {
      const itemName = (item.item_name || item.name || '').toLowerCase();
      const categoryName = (item.category_name || item.category || '').toLowerCase();
      const variantName = (item.variant_name || item.variant || '').toLowerCase();
      const search = itemSearchTerm.toLowerCase();

      return itemName.includes(search) || categoryName.includes(search) || variantName.includes(search);
    });

    // THEN group filtered items by item_id_ref to show unique items only
    return filteredItemVariants.reduce((acc, item) => {
      const itemId = item.item_id_ref || item.id;
      if (!acc.find(i => (i.item_id_ref || i.id) === itemId)) {
        acc.push(item);
      }
      return acc;
    }, []);
  }, [itemVariants, itemSearchTerm]);

  return (
    <>
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h6" fontWeight="bold">
              Item Management
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAddNewItem}
            >
              Add New Item
            </Button>
          </Box>

          <Box display="flex" gap={2} mb={3}>
            <TextField
              fullWidth
              placeholder="Search items by name or category..."
              value={itemSearchTerm}
              onChange={(e) => setItemSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              size="small"
            />
            <Tooltip title="Refresh items">
              <IconButton
                onClick={handleRefresh}
                color="primary"
                sx={{
                  border: '1px solid',
                  borderColor: 'primary.main',
                  borderRadius: 1
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>

          {loading ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : filteredUniqueItems.length === 0 ? (
            <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" p={5}>
              <Typography variant="body1" color="text.secondary" gutterBottom>
                {itemSearchTerm ? 'No items found matching your search' : 'No items available'}
              </Typography>
              {itemSearchTerm && (
                <Typography variant="body2" color="text.secondary">
                  Try adjusting your search terms
                </Typography>
              )}
            </Box>
          ) : (
            <List>
              {filteredUniqueItems.map((item) => (
                <React.Fragment key={item.item_id_ref || item.id}>
                  <ListItem>
                    <Box display="flex" alignItems="center" gap={2} sx={{ flexGrow: 1 }}>
                      <Avatar
                        src={item.image}
                        sx={{ width: 50, height: 50 }}
                      >
                        {getCategoryIcon(item.category_name || item.category)}
                      </Avatar>
                      <ListItemText
                        primary={
                          <Typography variant="body1" fontWeight="bold">
                            {item.item_name || item.name}
                          </Typography>
                        }
                        secondary={
                          <Box display="flex" gap={1} alignItems="center">
                            <Chip
                              label={item.category_name || item.category}
                              size="small"
                            />
                            {item.brand_name && (
                              <Chip
                                label={item.brand_name}
                                size="small"
                                variant="outlined"
                                color="primary"
                              />
                            )}
                          </Box>
                        }
                      />
                    </Box>
                    <ListItemSecondaryAction>
                      <IconButton edge="end" onClick={() => handleEditItemInline(item)}>
                        <EditIcon />
                      </IconButton>
                      <IconButton edge="end" onClick={() => handleDeleteItemInline(item)} color="error">
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                  <Divider />
                </React.Fragment>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Item Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingItem ? 'Edit Item' : 'Add New Item'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 0.5 }}>
            {/* Item Name */}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Item Name"
                value={itemFormData.name}
                onChange={(e) => setItemFormData({ ...itemFormData, name: e.target.value })}
                onBlur={() => setFormFieldTouched(prev => ({ ...prev, name: true }))}
                required
                error={formFieldTouched.name && !itemFormData.name.trim()}
                helperText={formFieldTouched.name && !itemFormData.name.trim() ? 'Item name is required' : ''}
                autoFocus
              />
            </Grid>

            {/* Category - Cascading Menu (Left side) */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required error={formFieldTouched.category && !itemFormData.category_id}>
                <InputLabel>Category *</InputLabel>
                <Select
                  value={itemFormData.category_id || ''}
                  label="Category *"
                  open={false}
                  onClick={handleCategoryButtonClick}
                  onBlur={() => setFormFieldTouched(prev => ({ ...prev, category: true }))}
                  renderValue={() => itemFormData.category_name || ''}
                  IconComponent={ArrowDropDownIcon}
                  sx={{ cursor: 'pointer' }}
                >
                  <MenuItem value="">Select Category</MenuItem>
                </Select>
                {formFieldTouched.category && !itemFormData.category_id && (
                  <FormHelperText>Category selection is required</FormHelperText>
                )}
              </FormControl>

                {/* Main Category Menu */}
                <Menu
                  anchorEl={categoryAnchorEl}
                  open={Boolean(categoryAnchorEl)}
                  onClose={closeCategoryMenus}
                  sx={{ '& .MuiPaper-root': { minWidth: 220, maxHeight: 400 } }}
                >
                  {categories.map((category) => {
                    const hasSubs = category.subcategories?.length > 0;
                    const isActive = isInActivePath(category.id);
                    
                    return (
                      <MenuItem
                        key={category.id}
                        onClick={(e) => hasSubs ? openLevel1(e, category) : handleCategorySelect(category)}
                        onMouseEnter={(e) => hasSubs && openLevel1(e, category)}
                        selected={itemFormData.category_id === category.id}
                        sx={{
                          backgroundColor: isActive ? '#e3f2fd' : 'transparent',
                          color: isActive ? 'primary.main' : 'inherit',
                          fontWeight: isActive ? 600 : 400,
                          '&:hover': { backgroundColor: isActive ? '#bbdefb' : '#f5f5f5' },
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1} sx={{ flexGrow: 1 }}>
                          <span>{getCategoryIcon(category.name)}</span>
                          {category.name}
                        </Box>
                        {hasSubs && <ChevronRightIcon sx={{ color: isActive ? 'primary.main' : 'inherit' }} />}
                      </MenuItem>
                    );
                  })}
                </Menu>

                {/* Level 1 Submenu */}
                <Menu
                  anchorEl={level1Anchor}
                  open={Boolean(level1Anchor)}
                  onClose={() => {}}
                  anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                  hideBackdrop
                  disableAutoFocus
                  disableEnforceFocus
                  sx={{
                    pointerEvents: 'none',
                    '& .MuiPaper-root': { 
                      pointerEvents: 'auto',
                      minWidth: 220, 
                      maxHeight: 400 
                    },
                  }}
                >
                  {level1Category?.subcategories?.map((subcat) => {
                    const hasDeepSubs = subcat.subcategories?.length > 0;
                    const isActive = isInActivePath(subcat.id);
                    
                    return (
                      <MenuItem
                        key={subcat.id}
                        onClick={(e) => hasDeepSubs ? openLevel2(e, subcat) : handleCategorySelect(subcat)}
                        onMouseEnter={(e) => hasDeepSubs && openLevel2(e, subcat)}
                        selected={itemFormData.category_id === subcat.id}
                        sx={{
                          backgroundColor: isActive ? '#e3f2fd' : 'transparent',
                          color: isActive ? 'primary.main' : 'inherit',
                          '&:hover': { backgroundColor: isActive ? '#bbdefb' : '#f5f5f5' },
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={1} sx={{ flexGrow: 1 }}>
                          {subcat.name}
                        </Box>
                        {hasDeepSubs && <ChevronRightIcon sx={{ color: isActive ? 'primary.main' : 'inherit' }} />}
                      </MenuItem>
                    );
                  })}
                </Menu>

                {/* Level 2 Submenu */}
                <Menu
                  anchorEl={level2Anchor}
                  open={Boolean(level2Anchor)}
                  onClose={() => {}}
                  anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                  hideBackdrop
                  disableAutoFocus
                  disableEnforceFocus
                  sx={{
                    pointerEvents: 'none',
                    '& .MuiPaper-root': { 
                      pointerEvents: 'auto',
                      minWidth: 200, 
                      maxHeight: 400 
                    },
                  }}
                >
                  {level2Category?.subcategories?.map((deepSubcat) => (
                    <MenuItem
                      key={deepSubcat.id}
                      onClick={() => handleCategorySelect(deepSubcat)}
                      selected={itemFormData.category_id === deepSubcat.id}
                      sx={{ '&:hover': { backgroundColor: '#f5f5f5' } }}
                    >
                      {deepSubcat.name}
                    </MenuItem>
                  ))}
                </Menu>
            </Grid>

            {/* Brand Selection (Right side) */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Brand</InputLabel>
                <Select
                  value={itemFormData.brand_id}
                  label="Brand"
                  onChange={(e) => setItemFormData({ ...itemFormData, brand_id: e.target.value })}
                >
                  {brands.map((brand) => (
                    <MenuItem key={brand.id} value={brand.id}>
                      {brand.brand_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Gender Selection */}
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                Gender
              </Typography>
              <Box display="flex" gap={2}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={itemFormData.gender === 'MEN'}
                      onChange={() => setItemFormData({ ...itemFormData, gender: 'MEN' })}
                      sx={{ '&.Mui-checked': { color: '#1976d2' } }}
                    />
                  }
                  label="Men"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={itemFormData.gender === 'WOMEN'}
                      onChange={() => setItemFormData({ ...itemFormData, gender: 'WOMEN' })}
                      sx={{ '&.Mui-checked': { color: '#e91e63' } }}
                    />
                  }
                  label="Women"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={itemFormData.gender === 'UNISEX'}
                      onChange={() => setItemFormData({ ...itemFormData, gender: 'UNISEX' })}
                      sx={{ '&.Mui-checked': { color: '#4CAF50' } }}
                    />
                  }
                  label="Unisex"
                />
              </Box>
            </Grid>

            {/* Image Upload */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>
                Item Image
              </Typography>
              <Box display="flex" alignItems="center" gap={2}>
                <Box>
                  {itemFormData.imagePreview ? (
                    <Badge
                      overlap="circular"
                      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                      badgeContent={
                        <Tooltip title="Remove image">
                          <IconButton
                            size="small"
                            onClick={removeImageInline}
                            sx={{
                              bgcolor: 'error.main',
                              color: 'white',
                              '&:hover': { bgcolor: 'error.dark' }
                            }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <Avatar
                        src={itemFormData.imagePreview}
                        sx={{ width: 80, height: 80 }}
                      />
                    </Badge>
                  ) : (
                    <Avatar
                      sx={{
                        width: 80,
                        height: 80,
                        bgcolor: 'grey.200',
                        fontSize: '2rem'
                      }}
                    >
                      {itemFormData.category_name ? getCategoryIcon(itemFormData.category_name) : <ImageIcon />}
                    </Avatar>
                  )}
                </Box>

                <Box>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUploadInline}
                    style={{ display: 'none' }}
                    ref={itemFileInputRef}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<PhotoCameraIcon />}
                    onClick={() => itemFileInputRef.current?.click()}
                  >
                    Upload Image
                  </Button>
                  <Typography variant="caption" display="block" color="text.secondary">
                    Max 5MB. If no image is uploaded, category icon will be used.
                  </Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveItemInline}
            variant="contained"
            disabled={savingItem}
            startIcon={savingItem && <CircularProgress size={20} />}
          >
            {savingItem ? 'Saving...' : (editingItem ? 'Update' : 'Add')} Item
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
});

const Inventory = () => {
  const dispatch = useDispatch();
  const { categories, variants, itemVariants, loading } = useSelector((state) => state.inventory);
  const { user } = useSelector((state) => state.auth);
  const [currentTab, setCurrentTab] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [addItemDialog, setAddItemDialog] = useState(false);
  const [editItemDialog, setEditItemDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [newItem, setNewItem] = useState({
    name: '',
    category: '',
    variant: '',
    image: null,
    imagePreview: null,
  });

  // Image and barcode handling
  const fileInputRef = useRef(null);
  const [isScanning, setIsScanning] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');

  // Category management states
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [selectedCategoryEdit, setSelectedCategoryEdit] = useState(null);
  const [newCategory, setNewCategory] = useState({ name: '' });
  const [addStockDialog, setAddStockDialog] = useState(false);
  const [selectedItemForStock, setSelectedItemForStock] = useState(null);
  const [newStockData, setNewStockData] = useState({
    buyingPrice: '',
    quantity: '',
    description: ''
  });

  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [loadingCategories, setLoadingCategories] = useState(false);

  // Variant management states
  const [variantDialog, setVariantDialog] = useState(false);
  const [selectedVariantEdit, setSelectedVariantEdit] = useState(null);
  const [newVariant, setNewVariant] = useState({ variant_name: '' });
  const [deleteVariantConfirmDialog, setDeleteVariantConfirmDialog] = useState(false);
  const [variantToDelete, setVariantToDelete] = useState(null);
  const [loadingVariants, setLoadingVariants] = useState(false);

  // Item saving loading state
  const [savingItem, setSavingItem] = useState(false);

  // Price history states
  const [priceHistoryDialog, setPriceHistoryDialog] = useState(false);
  const [selectedItemForHistory, setSelectedItemForHistory] = useState(null);

  // Stock batch details states
  const [stockBatchDialog, setStockBatchDialog] = useState(false);
  const [selectedItemForStockBatch, setSelectedItemForStockBatch] = useState(null);
  const [stockBatchData, setStockBatchData] = useState([]);
  const [stockMovementsData, setStockMovementsData] = useState([]);
  const [loadingStockBatch, setLoadingStockBatch] = useState(false);
  const [stockFilters, setStockFilters] = useState({
    type: 'stockIn' // 'stockIn' or 'sale'
  });
  const [dateFilters, setDateFilters] = useState({
    fromDate: '',
    toDate: ''
  });

  // Edit stock batch states
  const [editStockBatchDialog, setEditStockBatchDialog] = useState(false);
  const [editingStockBatch, setEditingStockBatch] = useState(null);
  const [editStockBatchData, setEditStockBatchData] = useState({
    initial_qty: '',
    remaining_qty: ''
  });
  const [savingStockBatch, setSavingStockBatch] = useState(false);

  // Low Stock and Out of Stock dialog states
  const [lowStockDialog, setLowStockDialog] = useState(false);
  const [outOfStockDialog, setOutOfStockDialog] = useState(false);

  // Add Item Variant dialog states
  const [addItemVariantDialog, setAddItemVariantDialog] = useState(false);
  const [newItemVariant, setNewItemVariant] = useState({
    item_id: '',
    variant_id: '',
    barcode: '',
    sellingPrice: ''
  });
  const [itemSearchText, setItemSearchText] = useState('');

  useEffect(() => {
    dispatch(fetchCategories());
    dispatch(fetchVariants());
    dispatch(fetchItemVariants());
  }, [dispatch]);

  // Add console logging to see the structure of itemVariants
  useEffect(() => {
    console.log('Item Variants:', itemVariants);
  }, [itemVariants]);

  const handleTabChange = (event, newValue) => {
    setCurrentTab(newValue);
  };

  // Category Management Functions
  const handleAddCategory = () => {
    setSelectedCategoryEdit(null);
    setNewCategory({ name: '' });
    setCategoryDialog(true);
  };

  const handleEditCategory = (category) => {
    setSelectedCategoryEdit(category);
    setNewCategory({ name: category.name });
    setCategoryDialog(true);
  };

  const handleCloseCategoryDialog = () => {
    setCategoryDialog(false);
    setSelectedCategoryEdit(null);
    setNewCategory({ name: '' });
  };

  const handleSaveCategory = async () => {
    if (!newCategory.name) {
      toast.error('Category name is required');
      return;
    }

    setLoadingCategories(true);
    try {
      if (selectedCategoryEdit) {
        await api.categories.update(selectedCategoryEdit.id, newCategory);
        toast.success('Category updated successfully');
      } else {
        await api.categories.create(newCategory);
        toast.success('Category added successfully');
      }
      dispatch(fetchCategories());
      handleCloseCategoryDialog();
    } catch (error) {
      toast.error(`Error: ${error.message || 'Failed to save category'}`);
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleDeleteCategory = (categoryId) => {
    setCategoryToDelete(categoryId);
    setDeleteConfirmDialog(true);
  };

  const confirmDeleteCategory = async () => {
    setLoadingCategories(true);
    try {
      await api.categories.delete(categoryToDelete);
      toast.success('Category deleted successfully');
      dispatch(fetchCategories());
      setDeleteConfirmDialog(false);
      setCategoryToDelete(null);
    } catch (error) {
      toast.error(`Error: ${error.message || 'Failed to delete category'}`);
    } finally {
      setLoadingCategories(false);
    }
  };

  // Variant Management Functions
  const handleAddVariant = () => {
    setSelectedVariantEdit(null);
    setNewVariant({ variant_name: '' });
    setVariantDialog(true);
  };

  const handleEditVariant = (variant) => {
    setSelectedVariantEdit(variant);
    setNewVariant({ variant_name: variant.variant_name });
    setVariantDialog(true);
  };

  const handleCloseVariantDialog = () => {
    setVariantDialog(false);
    setSelectedVariantEdit(null);
    setNewVariant({ variant_name: '' });
  };

  const handleSaveVariant = async () => {
    if (!newVariant.variant_name) {
      toast.error('Variant name is required');
      return;
    }

    setLoadingVariants(true);
    try {
      if (selectedVariantEdit) {
        await api.variants.update(selectedVariantEdit.id, newVariant);
        toast.success('Variant updated successfully');
      } else {
        await api.variants.create(newVariant);
        toast.success('Variant added successfully');
      }
      dispatch(fetchVariants());
      handleCloseVariantDialog();
    } catch (error) {
      toast.error(`Error: ${error.message || 'Failed to save variant'}`);
    } finally {
      setLoadingVariants(false);
    }
  };

  const handleDeleteVariant = (variantId) => {
    setVariantToDelete(variantId);
    setDeleteVariantConfirmDialog(true);
  };

  const confirmDeleteVariant = async () => {
    setLoadingVariants(true);
    try {
      await api.variants.delete(variantToDelete);
      toast.success('Variant deleted successfully');
      dispatch(fetchVariants());
      setDeleteVariantConfirmDialog(false);
      setVariantToDelete(null);
    } catch (error) {
      toast.error(`Error: ${error.message || 'Failed to delete variant'}`);
    } finally {
      setLoadingVariants(false);
    }
  };

  // Add state for tracking field interactions
  const [fieldTouched, setFieldTouched] = useState({
    name: false,
    category: false,
    variant: false,
  });

  const handleAddItem = () => {
    setNewItemVariant({
      item_id: '',
      variant_id: '',
      barcode: '',
      sellingPrice: ''
    });
    setItemSearchText('');
    setAddItemVariantDialog(true);
  };

  const handleSaveItemVariant = async () => {
    if (!newItemVariant.item_id || !newItemVariant.variant_id) {
      toast.error('Please select both item and variant');
      return;
    }

    try {
      await api.itemVariants.create({
        item_id: newItemVariant.item_id,
        variant_id: newItemVariant.variant_id,
        barcode: newItemVariant.barcode || null,
        selling_price: newItemVariant.sellingPrice ? parseFloat(newItemVariant.sellingPrice) : undefined,
        user_id: user?.id
      });
      toast.success('Item variant added successfully');
      dispatch(fetchItemVariants());
      setAddItemVariantDialog(false);
    } catch (error) {
      toast.error('Failed to add item variant: ' + error.message);
    }
  };

  // Image handling functions
  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error('Please select a valid image file');
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size should be less than 5MB');
        return;
      }

      try {
        // Compress image for better performance
        const options = {
          maxSizeMB: 1,              // Max 1MB
          maxWidthOrHeight: 1920,    // Max resolution
          quality: 0.85,             // 85% quality
          useWebWorker: true
        };
        
        const compressedFile = await imageCompression(file, options);
        
        // Show compression info
        const originalSizeMB = (file.size / 1024 / 1024).toFixed(2);
        const compressedSizeMB = (compressedFile.size / 1024 / 1024).toFixed(2);
        console.log(`Image compressed: ${originalSizeMB}MB → ${compressedSizeMB}MB`);

        // Create preview
        const reader = new FileReader();
        reader.onload = (e) => {
          setNewItem(prev => ({
            ...prev,
            image: compressedFile,
            imagePreview: e.target.result
          }));
        };
        reader.readAsDataURL(compressedFile);
      } catch (error) {
        console.error('Error compressing image:', error);
        toast.error('Failed to compress image');
      }
    }
  };

  const removeImage = () => {
    setNewItem(prev => ({
      ...prev,
      image: null,
      imagePreview: null
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Barcode scanning functions
  const handleBarcodeChange = async (value) => {
    setBarcodeInput(value);
    setNewItem(prev => ({ ...prev, barcode: value }));

    // If barcode is complete (assuming 8+ digits), try to fetch product info
    if (value.length >= 8) {
      try {
        setIsScanning(true);
        // Try to search for existing item with this barcode
        const result = await api.itemVariants.searchByBarcode(value);
        if (result && result.length > 0) {
          const existingItem = result[0];
          toast.info(`Found existing item: ${existingItem.itemName || existingItem.name}`);
          // Pre-fill fields with existing item data
          setNewItem(prev => ({
            ...prev,
            name: existingItem.itemName || existingItem.name || prev.name,
            category: existingItem.categoryName || existingItem.category || prev.category,
            variant: existingItem.variantName || existingItem.variant || prev.variant,
            sellingPrice: existingItem.selling_price?.toString() || prev.sellingPrice,
            description: existingItem.description || prev.description,
          }));
        }
      } catch (error) {
        // If no existing item found, that's fine for new items
        console.log('No existing item found with this barcode');
      } finally {
        setIsScanning(false);
      }
    }
  };

  // Enhanced barcode input handler for automatic scanning
  const handleBarcodeInputChange = (e) => {
    const value = e.target.value;
    handleBarcodeChange(value);
  };

  // Handle barcode scanner input (for hardware scanners)
  const handleBarcodeKeyPress = (e) => {
    // Many barcode scanners send Enter after scanning
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = e.target.value;
      if (value.length >= 8) {
        handleBarcodeChange(value);
      }
    }
  };

  const generateBarcode = () => {
    // Generate a simple barcode (you can enhance this)
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const generatedBarcode = timestamp.slice(-8) + random;
    handleBarcodeChange(generatedBarcode);
  };

  // Get category icon based on category name


  const handleAddStockClick = (item) => {
    // Check if item has a variant (item.id is the item_variant.id)
    if (!item.id) {
      toast.warning('Please add a variant to this item first before adding stock. Go to the ITEM tab to manage variants.');
      return;
    }

    setSelectedItemForStock(item);
    setNewStockData({
      buyingPrice: '',
      quantity: '',
      description: ''
    });
    setAddStockDialog(true);
  };

  const handleViewStockBatch = async (item) => {
    setSelectedItemForStockBatch(item);
    setLoadingStockBatch(true);
    setStockBatchDialog(true);
    // Reset filters to show stock in by default
    setStockFilters({
      type: 'stockIn'
    });
    setDateFilters({
      fromDate: '',
      toDate: ''
    });

    try {
      // Load both stock batches and movements data
      const [stockBatches, stockMovements] = await Promise.all([
        api.stock.getStockBatches(item.id),
        api.stock.getStockHistory(item.id)
      ]);
      
      setStockBatchData(stockBatches || []);
      setStockMovementsData(stockMovements || []);
    } catch (error) {
      console.error('Error fetching stock data:', error);
      toast.error('Failed to load stock data');
      setStockBatchData([]);
      setStockMovementsData([]);
    } finally {
      setLoadingStockBatch(false);
    }
  };

  const handleStockFilterChange = (filterType) => {
    setStockFilters(prev => ({
      type: prev.type === filterType ? 'all' : filterType
    }));
  };

  const handleEditStockBatch = (stockBatch) => {
    setEditingStockBatch(stockBatch);
    setEditStockBatchData({
      initial_qty: stockBatch.initial_qty || stockBatch.quantity || '',
      remaining_qty: stockBatch.remaining_qty !== undefined ? stockBatch.remaining_qty : ''
    });
    setEditStockBatchDialog(true);
  };

  const handleSaveStockBatchEdit = async () => {
    if (!editStockBatchData.initial_qty || editStockBatchData.remaining_qty === '') {
      toast.error('Both initial quantity and remaining quantity are required');
      return;
    }

    const initialQty = parseFloat(editStockBatchData.initial_qty);
    const remainingQty = parseFloat(editStockBatchData.remaining_qty);

    if (isNaN(initialQty) || isNaN(remainingQty)) {
      toast.error('Please enter valid numbers');
      return;
    }

    // Validation: Initial quantity must be greater than 0
    if (initialQty <= 0) {
      toast.error('Initial quantity must be greater than 0');
      return;
    }

    // Validation: Remaining quantity cannot be negative
    if (remainingQty < 0) {
      toast.error('Remaining quantity cannot be negative');
      return;
    }

    // Validation: Remaining quantity cannot exceed initial quantity
    if (remainingQty > initialQty) {
      toast.error('Remaining quantity cannot be greater than initial quantity');
      return;
    }

    setSavingStockBatch(true);
    try {
      await api.stock.updateBatch(editingStockBatch.id, {
        initial_qty: initialQty,
        remaining_qty: remainingQty
      });

      toast.success('Stock batch updated successfully');
      setEditStockBatchDialog(false);
      
      // Refresh the stock batch data
      if (selectedItemForStockBatch) {
        const stockBatches = await api.stock.getStockBatches(selectedItemForStockBatch.id);
        setStockBatchData(stockBatches || []);
      }
    } catch (error) {
      console.error('Error updating stock batch:', error);
      toast.error('Failed to update stock batch');
    } finally {
      setSavingStockBatch(false);
    }
  };

  const filteredStockData = useMemo(() => {
    const dataSource = stockFilters.type === 'stockIn' ? stockBatchData : stockMovementsData;
    
    let filtered = dataSource;

    // Date filter
    if (dateFilters.fromDate || dateFilters.toDate) {
      filtered = filtered.filter(movement => {
        const movementDate = movement.date ? new Date(movement.date) : movement.created_at ? new Date(movement.created_at) : null;
        if (!movementDate) return false;

        if (dateFilters.fromDate) {
          const fromDate = new Date(dateFilters.fromDate);
          fromDate.setHours(0, 0, 0, 0); // Start of day
          if (movementDate < fromDate) return false;
        }

        if (dateFilters.toDate) {
          const toDate = new Date(dateFilters.toDate);
          toDate.setHours(23, 59, 59, 999); // End of day
          if (movementDate > toDate) return false;
        }

        return true;
      });
    }

    return filtered;
  }, [stockBatchData, stockMovementsData, stockFilters, dateFilters]);

  const handleSaveNewStock = async () => {
    if (!newStockData.quantity || !newStockData.buyingPrice) {
      toast.error('Quantity and buying price are required');
      return;
    }

    try {
      await api.stock.addBatch({
        item_variant_id: selectedItemForStock.id,
        quantity: parseInt(newStockData.quantity),
        buyingPrice: parseFloat(newStockData.buyingPrice),
        description: newStockData.description || ''
      });
      toast.success('Stock batch added successfully');
      dispatch(fetchItemVariants());
      setAddStockDialog(false);
    } catch (error) {
      toast.error(`Error: ${error.message || 'Failed to add stock'}`);
    }
  };

  const handleEditItem = (item) => {
    setSelectedItem(item);
    setNewItem({
      name: item.item_name || item.name || '',
      category: item.category_name || item.category || '',
      variant: item.variant_name || item.variant || '',
      image: null,
      imagePreview: item.image || null,
      barcode: item.barcode || '',
      sellingPrice: (item.selling_price || item.price || '').toString(),
      buyingPrice: (item.buying_price || item.buyingPrice || '').toString(),
      initialQuantity: (item.total_stock || item.stock || '').toString(),
      description: item.description || '',
    });
    setBarcodeInput(item.barcode || '');
    setEditItemDialog(true);
  };

  const handleSaveItem = async () => {
    // Validate required fields
    if (!newItem.name.trim()) {
      toast.error('Item name is required.');
      setFieldTouched(prev => ({ ...prev, name: true }));
      return;
    }

    if (!newItem.category) {
      toast.error('Category selection is required.');
      setFieldTouched(prev => ({ ...prev, category: true }));
      return;
    }

    if (!newItem.variant) {
      toast.error('Variant selection is required.');
      setFieldTouched(prev => ({ ...prev, variant: true }));
      return;
    }

    setSavingItem(true);
    try {
      const formData = new FormData();
      formData.append('name', newItem.name);
      formData.append('category', newItem.category);
      formData.append('variant', newItem.variant);
      formData.append('barcode', newItem.barcode);
      formData.append('sellingPrice', newItem.sellingPrice);
      formData.append('buyingPrice', newItem.buyingPrice);
      formData.append('initialQuantity', newItem.initialQuantity);
      formData.append('description', newItem.description);

      if (newItem.image) {
        formData.append('image', newItem.image);
      }

      if (selectedItem) {
        // Update existing item variant
        await api.itemVariants.updateFull(selectedItem.id, formData);
        toast.success('Item updated successfully');
      } else {
        toast.error('Add functionality moved to "Add New Final Selling Product"');
      }

      dispatch(fetchItemVariants());
      setEditItemDialog(false);
      setSelectedItem(null);
      setNewItem({
        name: '',
        category: categories.length > 0 ? categories[0].name : '',
        variant: '',
        image: null,
        imagePreview: null,
        barcode: '',
        sellingPrice: '',
        buyingPrice: '',
        initialQuantity: '',
        description: ''
      });
      setFieldTouched({
        name: false,
        category: false,
        variant: false,
      });

    } catch (error) {
      console.error('Error saving item:', error);
      toast.error('Error saving item: ' + error.message);
    } finally {
      setSavingItem(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      try {
        // Here you would call an API to delete the item
        toast.success('Item deleted successfully');
        dispatch(fetchItemVariants());
      } catch (error) {
        toast.error('Failed to delete item');
      }
    }
  };

  const filteredItems = useMemo(() => {
    return itemVariants.filter(item => {
      const itemName = item.item_name || item.name || '';
      const variantName = item.variant_name || item.variant || '';
      const categoryName = item.category_name || item.category || '';
      const barcodeValue = item.barcode || '';

      const matchesSearch = itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        variantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        categoryName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        barcodeValue.includes(searchTerm);

      const matchesCategory = selectedCategory === 'all' || categoryName === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [itemVariants, searchTerm, selectedCategory]);

  const lowStockItems = itemVariants.filter(item => {
    const stock = item.total_stock || item.stock || 0;
    return stock <= (item.minStock || 5) && stock > 0;
  });

  const outOfStockItems = itemVariants.filter(item => {
    const stock = item.total_stock || item.stock || 0;
    return stock === 0;
  });

  const getStockStatus = (item) => {
    const stock = item.total_stock || item.stock || 0;
    if (stock === 0) return { label: 'Out of Stock', color: 'error' };
    if (stock <= (item.minStock || 5)) return { label: 'Low Stock', color: 'warning' };
    return { label: 'In Stock', color: 'success' };
  };

  const InventoryOverview = () => (
    <Grid container spacing={3} mb={3}>
      <Grid item xs={12} md={4}>
        <Card>
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="h4" fontWeight="bold">
                  {itemVariants.length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Total Items
                </Typography>
              </Box>
              <InventoryIcon color="primary" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card 
          sx={{ 
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
            transition: 'all 0.2s'
          }}
          onClick={() => setLowStockDialog(true)}
        >
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="h4" fontWeight="bold" color="warning.main">
                  {lowStockItems.length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Low Stock (Click to View)
                </Typography>
              </Box>
              <WarningIcon color="warning" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card
          sx={{ 
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
            transition: 'all 0.2s'
          }}
          onClick={() => setOutOfStockDialog(true)}
        >
          <CardContent>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="h4" fontWeight="bold" color="error.main">
                  {outOfStockItems.length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Out of Stock (Click to View)
                </Typography>
              </Box>
              <TrendingDownIcon color="error" sx={{ fontSize: 40 }} />
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const ItemsTable = () => (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h6" fontWeight="bold">
            Inventory Items
          </Typography>
        </Box>

        <Box display="flex" gap={2} mb={3}>
          <TextField
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            select
            label="Category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="all">All Categories</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category.id} value={category.name}>
                {category.name}
              </MenuItem>
            ))}
          </TextField>
          <Tooltip title="Refresh items">
            <IconButton
              onClick={() => {
                dispatch(fetchItemVariants());
                toast.success('Items refreshed');
              }}
              color="primary"
              sx={{
                border: '1px solid',
                borderColor: 'primary.main',
                borderRadius: 1
              }}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Item Name</TableCell>
                <TableCell>Variant</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Price</TableCell>
                <TableCell>Stock</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Barcode</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredItems.map((item) => {
                const status = getStockStatus(item);
                return (
                  <TableRow key={item.id || `item-${item.item_id_ref}`}>
                    <TableCell>{item.item_name || item.name || '-'}</TableCell>
                    <TableCell>{item.variant_name || item.variant || '-'}</TableCell>
                    <TableCell>
                      <Chip label={item.category_name || item.category || '-'} size="small" />
                    </TableCell>
                    <TableCell>Rs. {(item.selling_price || item.price || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      {item.total_stock || item.stock || 0}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={status.label}
                        color={status.color}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{item.barcode || '-'}</TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => handleEditItem(item)}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="secondary"
                        onClick={() => handleAddStockClick(item)}
                        title="Add Stock"
                      >
                        <AddIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="info"
                        onClick={() => handleViewStockBatch(item)}
                        title="View Stock Details"
                      >
                        <ListAltIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => {
                          setSelectedItemForHistory(item);
                          setPriceHistoryDialog(true);
                        }}
                      >
                        <HistoryIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDeleteItem(item.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );

  const LowStockAlert = () => (
    lowStockItems.length > 0 && (
      <Card sx={{ mb: 3, border: '1px solid', borderColor: 'warning.main' }}>
        <CardContent>
          <Typography variant="h6" color="warning.main" gutterBottom>
            Low Stock Alert
          </Typography>
          <Grid container spacing={2}>
            {lowStockItems.slice(0, 6).map((item) => (
              <Grid item xs={12} sm={6} md={4} key={item.id}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    {item.name} ({item.variant})
                  </Typography>
                  <Chip
                    label={`${item.stock} left`}
                    color="warning"
                    size="small"
                  />
                </Box>
              </Grid>
            ))}
          </Grid>
          {lowStockItems.length > 6 && (
            <Typography variant="body2" color="text.secondary" mt={1}>
              +{lowStockItems.length - 6} more items need restocking
            </Typography>
          )}
        </CardContent>
      </Card>
    )
  );

  const CategoryManagement = () => (
    <Card>
      <CardContent>
        <Box display="flex" flexDirection="column" alignItems="flex-start" gap={2}>
          <Typography variant="h6" fontWeight="bold">
            Category Management
          </Typography>
          <CategoryManagementMenu 
            categories={categories}
          />
        </Box>
      </CardContent>
    </Card>
  );

  const VariantManagement = () => (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h6" fontWeight="bold">
            Variant Management
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddVariant}
          >
            Add Variant
          </Button>
        </Box>

        {loadingVariants ? (
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        ) : (
          <List>
            {variants.map((variant) => (
              <React.Fragment key={variant.id}>
                <ListItem>
                  <ListItemText
                    primary={
                      <Typography variant="body1">{variant.variant_name}</Typography>
                    }
                    secondary={`Examples: 250ml, Large, Small, etc.`}
                  />
                  <ListItemSecondaryAction>
                    <IconButton edge="end" onClick={() => handleEditVariant(variant)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton edge="end" onClick={() => handleDeleteVariant(variant.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
                <Divider />
              </React.Fragment>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );



  return (
    <Box p={3}>
      <Typography variant="h4" fontWeight="bold" mb={3}>
        Inventory Management
      </Typography>

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Tabs value={currentTab} onChange={handleTabChange}>
          <Tab label="Overview" />
          <Tab label="Categories" />
          <Tab label="Brands" />
          <Tab label="Variants" />
          <Tab label="ITEM" />
        </Tabs>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddItem}
          sx={{
            bgcolor: '#4CAF50',
            '&:hover': { bgcolor: '#388E3C' },
            fontWeight: 'bold',
            px: 3,
          }}
        >
          Add New Final Selling Product
        </Button>
      </Box>

      {currentTab === 0 && (
        <>
          {InventoryOverview()}
          {LowStockAlert()}
          {ItemsTable()}
        </>
      )}

      {currentTab === 1 && <CategoryManagement />}

      {currentTab === 2 && <BrandManagementMenu />}

      {currentTab === 3 && <VariantManagement />}

      {currentTab === 4 && (
        <ItemManagement
          categories={categories}
          itemVariants={itemVariants}
          itemSearchTerm={itemSearchTerm}
          setItemSearchTerm={setItemSearchTerm}
          loading={loading}
        />
      )}

      {/* Add Item with Variants Dialog - Commented out as we use simplified dialog now */}
      {/* <AddItemWithVariants
        open={addItemDialog}
        onClose={() => {
          setAddItemDialog(false);
          dispatch(fetchItemVariants());
        }}
        categories={categories}
        variants={variants}
      /> */}

      {/* Edit Item Dialog - Keep for single item editing */}
      <Dialog
        open={editItemDialog}
        onClose={() => {
          setEditItemDialog(false);
          setSelectedItem(null);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {selectedItem ? 'Edit Item' : 'Add New Item'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            {/* Item Name - Required */}
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Item Name"
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                onBlur={() => setFieldTouched(prev => ({ ...prev, name: true }))}
                required
                error={fieldTouched.name && !newItem.name.trim()}
                helperText={fieldTouched.name && !newItem.name.trim() ? 'Item name is required' : ''}
              />
            </Grid>

            {/* Category Image Section */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>
                Category Image
              </Typography>
              <Box display="flex" alignItems="center" gap={2}>
                {/* Image Preview */}
                <Box>
                  {newItem.imagePreview ? (
                    <Badge
                      overlap="circular"
                      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                      badgeContent={
                        <Tooltip title="Remove image">
                          <IconButton
                            size="small"
                            onClick={removeImage}
                            sx={{
                              bgcolor: 'error.main',
                              color: 'white',
                              '&:hover': { bgcolor: 'error.dark' }
                            }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <Avatar
                        src={newItem.imagePreview}
                        sx={{ width: 80, height: 80 }}
                      />
                    </Badge>
                  ) : (
                    <Avatar
                      sx={{
                        width: 80,
                        height: 80,
                        bgcolor: 'grey.200',
                        fontSize: '2rem'
                      }}
                    >
                      {newItem.category ? getCategoryIcon(newItem.category) : <ImageIcon />}
                    </Avatar>
                  )}
                </Box>

                {/* Upload Button */}
                <Box>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                    ref={fileInputRef}
                  />
                  <Button
                    variant="outlined"
                    startIcon={<PhotoCameraIcon />}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload Image
                  </Button>
                  <Typography variant="caption" display="block" color="text.secondary">
                    Max 5MB. If no image is uploaded, category icon will be used.
                  </Typography>
                </Box>
              </Box>
            </Grid>

            {/* Category Selection - Required */}
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth required error={fieldTouched.category && !newItem.category}>
                <InputLabel>Category *</InputLabel>
                <Select
                  value={newItem.category}
                  label="Category *"
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                  onBlur={() => setFieldTouched(prev => ({ ...prev, category: true }))}
                >
                  {categories.map((category) => (
                    <MenuItem key={category.id} value={category.name}>
                      <Box display="flex" alignItems="center" gap={1}>
                        <span>{getCategoryIcon(category.name)}</span>
                        {category.name}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
                {fieldTouched.category && !newItem.category && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                    Category selection is required
                  </Typography>
                )}
              </FormControl>
            </Grid>

            {/* Variant Selection - Required */}
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth required error={fieldTouched.variant && !newItem.variant}>
                <InputLabel>Variant *</InputLabel>
                <Select
                  value={newItem.variant}
                  label="Variant *"
                  onChange={(e) => setNewItem({ ...newItem, variant: e.target.value })}
                  onBlur={() => setFieldTouched(prev => ({ ...prev, variant: true }))}
                >
                  {variants.map((variant) => (
                    <MenuItem key={variant.id} value={variant.variant_name}>
                      {variant.variant_name}
                    </MenuItem>
                  ))}
                </Select>
                {fieldTouched.variant && !newItem.variant && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                    Variant selection is required
                  </Typography>
                )}
              </FormControl>
            </Grid>

            {/* Barcode */}
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Barcode"
                value={newItem.barcode}
                onChange={(e) => setNewItem({ ...newItem, barcode: e.target.value })}
                placeholder="Enter or scan barcode"
                InputProps={{
                  startAdornment: <InputAdornment position="start"><QrCodeScannerIcon /></InputAdornment>,
                }}
                helperText="Barcode for this product variant"
              />
            </Grid>

            {/* Selling Price */}
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Selling Price"
                type="number"
                value={newItem.sellingPrice}
                onChange={(e) => setNewItem({ ...newItem, sellingPrice: e.target.value })}
                InputProps={{
                  startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setAddItemDialog(false);
              setEditItemDialog(false);
              setNewItem({
                name: '',
                category: '',
                variant: '',
                image: null,
                imagePreview: null,
              });
              setFieldTouched({
                name: false,
                category: false,
                variant: false,
              });
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveItem}
            variant="contained"
            disabled={savingItem}
            startIcon={savingItem && <CircularProgress size={20} />}
          >
            {savingItem ? 'Saving...' : (selectedItem ? 'Update' : 'Add')} Item
          </Button>
        </DialogActions>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={categoryDialog} onClose={handleCloseCategoryDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {selectedCategoryEdit ? 'Edit Category' : 'Add New Category'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Category Name"
                value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                autoFocus
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCategoryDialog}>Cancel</Button>
          <Button
            onClick={handleSaveCategory}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={loadingCategories}
          >
            {loadingCategories ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Category Confirmation Dialog */}
      <Dialog
        open={deleteConfirmDialog}
        onClose={() => setDeleteConfirmDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Confirm Delete Category
        </DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this category? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={confirmDeleteCategory}
            variant="contained"
            color="error"
            disabled={loadingCategories}
          >
            {loadingCategories ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Variant Dialog */}
      <Dialog open={variantDialog} onClose={handleCloseVariantDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {selectedVariantEdit ? 'Edit Variant' : 'Add New Variant'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Variant Name"
                value={newVariant.variant_name}
                onChange={(e) => setNewVariant({ ...newVariant, variant_name: e.target.value })}
                placeholder="e.g., 10ml, 50ml, 100ml, Red, Vanilla, Rose, Large, Small"
                autoFocus
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseVariantDialog}>Cancel</Button>
          <Button
            onClick={handleSaveVariant}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={loadingVariants}
          >
            {loadingVariants ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Variant Confirmation Dialog */}
      <Dialog
        open={deleteVariantConfirmDialog}
        onClose={() => setDeleteVariantConfirmDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Confirm Delete Variant
        </DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this variant? This action cannot be undone and may affect existing items.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteVariantConfirmDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={confirmDeleteVariant}
            variant="contained"
            color="error"
            disabled={loadingVariants}
          >
            {loadingVariants ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Stock Dialog */}
      <Dialog open={addStockDialog} onClose={() => setAddStockDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Stock to {selectedItemForStock?.item_name || selectedItemForStock?.name} - {selectedItemForStock?.variant_name || selectedItemForStock?.variant}</DialogTitle>
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
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description / Batch Info"
                multiline
                rows={2}
                value={newStockData.description}
                onChange={(e) => setNewStockData({ ...newStockData, description: e.target.value })}
                placeholder="e.g., Shipment from Supplier X, Batch #123"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddStockDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewStock} variant="contained" color="primary">
            Add Stock
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stock Batch Details Dialog */}
      <Dialog
        open={stockBatchDialog}
        onClose={() => setStockBatchDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Stock Details - {selectedItemForStockBatch?.item_name || selectedItemForStockBatch?.name} ({selectedItemForStockBatch?.variant_name || selectedItemForStockBatch?.variant})
        </DialogTitle>
        <DialogContent>
          {loadingStockBatch ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : stockBatchData.length === 0 ? (
            <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" p={3}>
              <Typography variant="body1" color="text.secondary">
                No stock data available
              </Typography>
            </Box>
          ) : (
            <>
              {/* Info Note */}
              {stockFilters.type === 'stockIn' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Click on any stock-in row to edit initial and remaining quantities.
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

              {/* Filter Radio Buttons */}
              <Box display="flex" gap={3} mb={2} p={2} bgcolor="grey.50" borderRadius={1}>
                <FormControlLabel
                  control={
                    <Radio
                      checked={stockFilters.type === 'stockIn'}
                      onChange={() => setStockFilters({ type: 'stockIn' })}
                      color="success"
                    />
                  }
                  label="Stock In"
                />
                <FormControlLabel
                  control={
                    <Radio
                      checked={stockFilters.type === 'sale'}
                      onChange={() => setStockFilters({ type: 'sale' })}
                      color="error"
                    />
                  }
                  label="Sale"
                />
              </Box>

              <TableContainer component={Paper} sx={{ mt: 2 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Type</TableCell>
                      {stockFilters.type === 'sale' && (
                        <TableCell>Transaction Qty</TableCell>
                      )}
                      {stockFilters.type === 'stockIn' && (
                        <>
                          <TableCell>Initial Qty</TableCell>
                          <TableCell>Remaining Qty</TableCell>
                        </>
                      )}
                      <TableCell>Reference</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredStockData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={stockFilters.type === 'stockIn' ? 5 : 5} align="center">
                          <Typography variant="body2" color="text.secondary">
                            No movements match the selected filters
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredStockData.map((movement, index) => (
                        <TableRow 
                          key={index}
                          onClick={() => {
                            if (stockFilters.type === 'stockIn') {
                              handleEditStockBatch(movement);
                            }
                          }}
                          sx={{
                            cursor: stockFilters.type === 'stockIn' ? 'pointer' : 'default',
                            '&:hover': stockFilters.type === 'stockIn' ? {
                              backgroundColor: 'action.hover'
                            } : {}
                          }}
                        >
                          <TableCell>
                            {movement.date ? new Date(movement.date).toLocaleDateString() : movement.created_at ? new Date(movement.created_at).toLocaleDateString() : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={stockFilters.type === 'stockIn' ? 'Stock In' : 'Sale'}
                              color={stockFilters.type === 'stockIn' ? 'success' : 'error'}
                              size="small"
                            />
                          </TableCell>
                          {stockFilters.type === 'sale' && (
                            <TableCell>{movement.quantity || 0}</TableCell>
                          )}
                          {stockFilters.type === 'stockIn' && (
                            <>
                              <TableCell>{movement.initial_qty || movement.quantity || 0}</TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight="bold">
                                  {movement.remaining_qty !== undefined ? movement.remaining_qty : 'N/A'}
                                </Typography>
                              </TableCell>
                            </>
                          )}
                          <TableCell>{movement.id || movement.reference_id || '-'}</TableCell>
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
          <Button onClick={() => setStockBatchDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Stock Batch Dialog */}
      <Dialog
        open={editStockBatchDialog}
        onClose={() => setEditStockBatchDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Edit Stock Batch
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {editingStockBatch && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Editing stock batch from {editingStockBatch.date ? new Date(editingStockBatch.date).toLocaleDateString() : editingStockBatch.created_at ? new Date(editingStockBatch.created_at).toLocaleDateString() : 'N/A'}
              </Alert>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Initial Quantity"
                  type="number"
                  value={editStockBatchData.initial_qty}
                  onChange={(e) => setEditStockBatchData({ ...editStockBatchData, initial_qty: e.target.value })}
                  inputProps={{ min: 0, step: 1 }}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Remaining Quantity"
                  type="number"
                  value={editStockBatchData.remaining_qty}
                  onChange={(e) => setEditStockBatchData({ ...editStockBatchData, remaining_qty: e.target.value })}
                  inputProps={{ min: 0, step: 1 }}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditStockBatchDialog(false)} disabled={savingStockBatch}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveStockBatchEdit} 
            variant="contained" 
            color="primary"
            disabled={savingStockBatch}
          >
            {savingStockBatch ? <CircularProgress size={24} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Item Variant Dialog */}
      <Dialog
        open={addItemVariantDialog}
        onClose={() => setAddItemVariantDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add New Item Variant</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <Autocomplete
                options={(() => {
                  // Get unique items from itemVariants
                  const uniqueItems = itemVariants.reduce((acc, item) => {
                    const itemId = item.item_id_ref || item.id;
                    if (!acc.find(i => (i.item_id_ref || i.id) === itemId)) {
                      acc.push({
                        id: itemId,
                        name: item.item_name || item.name,
                        category: item.category_name || item.category
                      });
                    }
                    return acc;
                  }, []);
                  return uniqueItems;
                })()}
                getOptionLabel={(option) => option.name || ''}
                value={(() => {
                  const uniqueItems = itemVariants.reduce((acc, item) => {
                    const itemId = item.item_id_ref || item.id;
                    if (!acc.find(i => (i.item_id_ref || i.id) === itemId)) {
                      acc.push({
                        id: itemId,
                        name: item.item_name || item.name,
                        category: item.category_name || item.category
                      });
                    }
                    return acc;
                  }, []);
                  return uniqueItems.find(item => item.id === newItemVariant.item_id) || null;
                })()}
                onChange={(event, newValue) => {
                  setNewItemVariant({
                    ...newItemVariant,
                    item_id: newValue ? newValue.id : ''
                  });
                }}
                inputValue={itemSearchText}
                onInputChange={(event, newInputValue) => {
                  setItemSearchText(newInputValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Item *"
                    placeholder="Search for an item..."
                    required
                  />
                )}
                renderOption={(props, option) => (
                  <Box component="li" {...props}>
                    <Box>
                      <Typography variant="body1">{option.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.category}
                      </Typography>
                    </Box>
                  </Box>
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <FormControl fullWidth required>
                <InputLabel>Variant *</InputLabel>
                <Select
                  value={newItemVariant.variant_id}
                  label="Variant *"
                  onChange={(e) => setNewItemVariant({ ...newItemVariant, variant_id: e.target.value })}
                >
                  {variants.map((variant) => (
                    <MenuItem key={variant.id} value={variant.id}>
                      {variant.variant_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Barcode"
                value={newItemVariant.barcode}
                onChange={(e) => setNewItemVariant({ ...newItemVariant, barcode: e.target.value })}
                placeholder="Enter barcode (optional)"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Selling Price"
                type="number"
                value={newItemVariant.sellingPrice}
                onChange={(e) => setNewItemVariant({ ...newItemVariant, sellingPrice: e.target.value })}
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
                placeholder="Optional"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddItemVariantDialog(false)}>
            Cancel
          </Button>
          <Button onClick={handleSaveItemVariant} variant="contained" color="primary">
            Add Item Variant
          </Button>
        </DialogActions>
      </Dialog>

      {/* Price History Dialog */}
      <Dialog
        open={priceHistoryDialog}
        onClose={() => setPriceHistoryDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Price History - {selectedItemForHistory?.item_name || selectedItemForHistory?.name} ({selectedItemForHistory?.variant_name || selectedItemForHistory?.variant})
        </DialogTitle>
        <DialogContent>
          {selectedItemForHistory && (
            <SellPriceHistory
              itemVariantId={selectedItemForHistory.id}
              currentPrice={selectedItemForHistory.selling_price || selectedItemForHistory.price}
              onPriceUpdate={() => {
                // Refresh inventory data when price is updated
                dispatch(fetchItemVariants());
              }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPriceHistoryDialog(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Low Stock Items Dialog */}
      <Dialog
        open={lowStockDialog}
        onClose={() => setLowStockDialog(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <WarningIcon color="warning" />
            Low Stock Items ({lowStockItems.length})
          </Box>
        </DialogTitle>
        <DialogContent>
          {lowStockItems.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography variant="body1" color="text.secondary">
                No low stock items found
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell>Variant</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Barcode</TableCell>
                    <TableCell align="right">Current Stock</TableCell>
                    <TableCell align="right">Selling Price</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lowStockItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.item_name || item.name}</TableCell>
                      <TableCell>{item.variant_name || item.variant}</TableCell>
                      <TableCell>{item.category_name || item.category}</TableCell>
                      <TableCell>{item.barcode || '-'}</TableCell>
                      <TableCell align="right">
                        <Chip
                          label={item.total_stock || item.stock || 0}
                          color="warning"
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">
                        Rs. {parseFloat(item.selling_price || item.price || 0).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLowStockDialog(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Out of Stock Items Dialog */}
      <Dialog
        open={outOfStockDialog}
        onClose={() => setOutOfStockDialog(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <TrendingDownIcon color="error" />
            Out of Stock Items ({outOfStockItems.length})
          </Box>
        </DialogTitle>
        <DialogContent>
          {outOfStockItems.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography variant="body1" color="text.secondary">
                No out of stock items found
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell>Variant</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Barcode</TableCell>
                    <TableCell align="right">Current Stock</TableCell>
                    <TableCell align="right">Selling Price</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {outOfStockItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.item_name || item.name}</TableCell>
                      <TableCell>{item.variant_name || item.variant}</TableCell>
                      <TableCell>{item.category_name || item.category}</TableCell>
                      <TableCell>{item.barcode || '-'}</TableCell>
                      <TableCell align="right">
                        <Chip
                          label="0"
                          color="error"
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">
                        Rs. {parseFloat(item.selling_price || item.price || 0).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOutOfStockDialog(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box >
  );
};

export default Inventory;