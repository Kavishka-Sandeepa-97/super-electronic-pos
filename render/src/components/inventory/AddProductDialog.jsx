import React, { useMemo, useState } from 'react';
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
  Divider,
  InputAdornment,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import { Add as AddIcon, Refresh as RefreshIcon, AddCircleOutline as AddCircleOutlineIcon } from '@mui/icons-material';
import { Autocomplete } from '@mui/material';
import { toast } from 'react-toastify';
import api from '../../services/api';

const AddProductDialog = ({
  open,
  onClose,
  itemVariants,
  variants,
  newItemVariant,
  setNewItemVariant,
  itemSearchText,
  setItemSearchText,
  variantSearchText,
  setVariantSearchText,
  onSave,
  onGenerateBarcode,
  onVariantCreated,
}) => {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickVariantName, setQuickVariantName] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);

  const handleQuickAddVariant = async () => {
    if (!quickVariantName.trim()) return;
    setQuickAdding(true);
    try {
      const created = await api.variants.create({ variant_name: quickVariantName.trim() });
      setNewItemVariant({ ...newItemVariant, variant_id: created.id });
      onVariantCreated();
      setQuickAddOpen(false);
      setQuickVariantName('');
      toast.success(`Variant "${created.variant_name}" added and selected`);
    } catch (e) {
      toast.error(`Failed to add variant: ${e.message}`);
    } finally {
      setQuickAdding(false);
    }
  };
  const uniqueItems = useMemo(() => {
    const seen = new Set();
    return itemVariants.reduce((acc, item) => {
      const itemId = item.item_id_ref || item.id;
      if (!seen.has(itemId)) {
        seen.add(itemId);
        acc.push({
          id: itemId,
          name: item.item_name || item.name,
          category: item.category_name || item.category,
        });
      }
      return acc;
    }, []);
  }, [itemVariants]);

  const selectedItem = uniqueItems.find(i => i.id === newItemVariant.item_id) || null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderTop: '4px solid #4CAF50', borderRadius: '8px' } }}
    >
      <DialogTitle sx={{ bgcolor: '#E8F5E9', color: '#2E7D32', fontWeight: 'bold', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 1 }}>
        <AddIcon sx={{ color: '#4CAF50' }} />
        Add New Final Selling Product
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Grid container spacing={2} sx={{ mt: 0 }}>
          {/* Item Selection */}
          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={uniqueItems}
              getOptionLabel={(option) => option.name || ''}
              value={selectedItem}
              onChange={(_, newValue) => setNewItemVariant({ ...newItemVariant, item_id: newValue ? newValue.id : '' })}
              inputValue={itemSearchText}
              onInputChange={(_, newInputValue) => setItemSearchText(newInputValue)}
              filterOptions={(options, { inputValue }) => {
                const filter = inputValue.toLowerCase();
                return options.filter(o =>
                  o.name.toLowerCase().includes(filter) ||
                  o.category.toLowerCase().includes(filter) ||
                  o.id.toString().includes(filter)
                );
              }}
              renderInput={(params) => (
                <TextField {...params} label="Select Item *" placeholder="Search by name, category or ID..." required helperText="Type to search through items" />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props}>
                  <Box>
                    <Typography variant="body1">{option.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{option.category} • Item ID: {option.id}</Typography>
                  </Box>
                </Box>
              )}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              noOptionsText="No items found"
            />
          </Grid>

          {/* Variant Selection */}
          <Grid item xs={12} sm={6}>
            <Box display="flex" gap={1} alignItems="flex-start">
              <Box flex={1}>
                <Autocomplete
                  options={variants}
                  getOptionLabel={(option) => option.variant_name || ''}
                  value={variants.find(v => v.id === newItemVariant.variant_id) || null}
                  onChange={(_, newValue) => setNewItemVariant({ ...newItemVariant, variant_id: newValue ? newValue.id : '' })}
                  inputValue={variantSearchText}
                  onInputChange={(_, newInputValue) => setVariantSearchText(newInputValue)}
                  filterOptions={(options, { inputValue }) => {
                    const filter = inputValue.toLowerCase();
                    return options.filter(o =>
                      o.variant_name.toLowerCase().includes(filter) ||
                      o.id.toString().includes(filter)
                    );
                  }}
                  renderInput={(params) => (
                    <TextField {...params} label="Select Variant *" placeholder="Search by variant name or ID..." required helperText="Type to search through variants" />
                  )}
                  renderOption={(props, option) => (
                    <Box component="li" {...props}>
                      <Box>
                        <Typography variant="body1">{option.variant_name}</Typography>
                        <Typography variant="caption" color="text.secondary">Variant ID: {option.id}</Typography>
                      </Box>
                    </Box>
                  )}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  noOptionsText="No variants found"
                />
              </Box>
              <Tooltip title="Add New Variant">
                <IconButton onClick={() => setQuickAddOpen(true)} sx={{ mt: 1, color: 'success.main' }}>
                  <AddCircleOutlineIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Grid>

          {/* Quick Add Variant Dialog */}
          <Dialog open={quickAddOpen} onClose={() => { setQuickAddOpen(false); setQuickVariantName(''); }} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 'bold' }}>Add New Variant</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                fullWidth
                label="Variant Name"
                value={quickVariantName}
                onChange={(e) => setQuickVariantName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAddVariant(); }}
                placeholder="e.g., 10ml, 50ml, Large, Small"
                sx={{ mt: 1 }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setQuickAddOpen(false); setQuickVariantName(''); }}>Cancel</Button>
              <Button
                onClick={handleQuickAddVariant}
                variant="contained"
                disabled={quickAdding || !quickVariantName.trim()}
                startIcon={quickAdding ? <CircularProgress size={16} /> : null}
              >
                {quickAdding ? 'Adding...' : 'Add'}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Barcode */}
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Barcode *"
              value={newItemVariant.barcode}
              onChange={(e) => setNewItemVariant({ ...newItemVariant, barcode: e.target.value })}
              placeholder="9-digit barcode"
              required
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={onGenerateBarcode} edge="end" title="Generate new barcode">
                      <RefreshIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>

          {/* Expire Date */}
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Expire Date"
              type="date"
              value={newItemVariant.expireDate}
              onChange={(e) => setNewItemVariant({ ...newItemVariant, expireDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {/* Buying Price */}
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Buying Price *"
              type="number"
              value={newItemVariant.buyingPrice}
              onChange={(e) => setNewItemVariant({ ...newItemVariant, buyingPrice: e.target.value })}
              InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
              required
            />
          </Grid>

          {/* Selling Price */}
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Selling Price *"
              type="number"
              value={newItemVariant.sellingPrice}
              onChange={(e) => setNewItemVariant({ ...newItemVariant, sellingPrice: e.target.value })}
              InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
              required
            />
          </Grid>

          {/* Quantity */}
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Quantity *"
              type="number"
              value={newItemVariant.quantity}
              onChange={(e) => setNewItemVariant({ ...newItemVariant, quantity: e.target.value })}
              required
            />
          </Grid>

          {/* Description */}
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Description"
              value={newItemVariant.description}
              onChange={(e) => setNewItemVariant({ ...newItemVariant, description: e.target.value })}
              multiline
              rows={2}
              placeholder="Optional description..."
            />
          </Grid>

          {/* Discount Settings */}
          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" gutterBottom color="secondary" sx={{ fontWeight: 'bold' }}>
              Discount Settings
            </Typography>
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth>
              <InputLabel>Discount Active</InputLabel>
              <Select
                value={newItemVariant.isDiscountActive ? 'yes' : 'no'}
                label="Discount Active"
                onChange={(e) => setNewItemVariant({ ...newItemVariant, isDiscountActive: e.target.value === 'yes' })}
              >
                <MenuItem value="no">No</MenuItem>
                <MenuItem value="yes">Yes</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth disabled={!newItemVariant.isDiscountActive}>
              <InputLabel>Discount Type</InputLabel>
              <Select
                value={newItemVariant.discountType || 'percentage'}
                label="Discount Type"
                onChange={(e) => setNewItemVariant({ ...newItemVariant, discountType: e.target.value })}
              >
                <MenuItem value="fixed">Fixed (Rs.)</MenuItem>
                <MenuItem value="percentage">Percentage (%)</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label={newItemVariant.discountType === 'percentage' ? 'Discount (%)' : 'Discount (Rs.)'}
              type="number"
              value={newItemVariant.discountValue}
              onChange={(e) => setNewItemVariant({ ...newItemVariant, discountValue: e.target.value })}
              disabled={!newItemVariant.isDiscountActive}
              inputProps={{ min: 0, step: 0.01 }}
            />
          </Grid>
          {newItemVariant.isDiscountActive && newItemVariant.sellingPrice && newItemVariant.discountValue ? (
            <Grid item xs={12}>
              <Alert severity="info">
                Final Price: Rs. {newItemVariant.discountType === 'percentage'
                  ? (parseFloat(newItemVariant.sellingPrice) - (parseFloat(newItemVariant.sellingPrice) * parseFloat(newItemVariant.discountValue) / 100)).toFixed(2)
                  : (parseFloat(newItemVariant.sellingPrice) - parseFloat(newItemVariant.discountValue)).toFixed(2)
                }
              </Alert>
            </Grid>
          ) : null}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onSave} variant="contained" sx={{ bgcolor: '#4CAF50', '&:hover': { bgcolor: '#388E3C' } }}>
          Add Product
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddProductDialog;
