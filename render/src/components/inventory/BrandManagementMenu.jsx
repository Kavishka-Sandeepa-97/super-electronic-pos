import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider,
  CircularProgress,
  Grid,
  InputAdornment,
  TablePagination,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Business as BusinessIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';

const BrandManagementMenu = () => {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [brandDialog, setBrandDialog] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [brandFormData, setBrandFormData] = useState({ brand_name: '', description: '' });
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [brandToDelete, setBrandToDelete] = useState(null);

  // Fetch brands on component mount
  useEffect(() => {
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    setLoading(true);
    try {
      const data = await api.brands.getAll();
      setBrands(data);
    } catch (error) {
      console.error('Error fetching brands:', error);
      toast.error('Failed to load brands');
    } finally {
      setLoading(false);
    }
  };

  const handleAddBrand = () => {
    setEditingBrand(null);
    setBrandFormData({ brand_name: '', description: '' });
    setBrandDialog(true);
  };

  const handleEditBrand = (brand) => {
    setEditingBrand(brand);
    setBrandFormData({ 
      brand_name: brand.brand_name, 
      description: brand.description || '' 
    });
    setBrandDialog(true);
  };

  const handleCloseBrandDialog = () => {
    setBrandDialog(false);
    setEditingBrand(null);
    setBrandFormData({ brand_name: '', description: '' });
  };

  const handleSaveBrand = async () => {
    if (!brandFormData.brand_name.trim()) {
      toast.error('Brand name is required');
      return;
    }

    setLoading(true);
    try {
      if (editingBrand) {
        await api.brands.update(editingBrand.id, brandFormData);
        toast.success('Brand updated successfully');
      } else {
        await api.brands.create(brandFormData);
        toast.success('Brand added successfully');
      }
      fetchBrands();
      handleCloseBrandDialog();
    } catch (error) {
      toast.error(error.message || 'Failed to save brand');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBrand = (brand) => {
    setBrandToDelete(brand);
    setDeleteDialog(true);
  };

  const confirmDeleteBrand = async () => {
    setLoading(true);
    try {
      await api.brands.delete(brandToDelete.id);
      toast.success('Brand deleted successfully');
      fetchBrands();
      setDeleteDialog(false);
      setBrandToDelete(null);
    } catch (error) {
      toast.error(error.message || 'Failed to delete brand');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Box display="flex" alignItems="center" gap={1}>
            <BusinessIcon color="primary" />
            <Typography variant="h6" fontWeight="bold">
              Brand Management
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddBrand}
          >
            Add Brand
          </Button>
        </Box>

        <TextField
          placeholder="Search brands..."
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setPage(0); }}
          size="small"
          sx={{ mb: 2, width: 280 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        {loading && !brandDialog ? (
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        ) : brands.length === 0 ? (
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" p={5}>
            <Typography variant="body1" color="text.secondary" gutterBottom>
              No brands available
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Click "Add Brand" to create your first brand
            </Typography>
          </Box>
        ) : (() => {
          const filtered = brands.filter(b =>
            b.brand_name.toLowerCase().includes(searchText.toLowerCase()) ||
            (b.description || '').toLowerCase().includes(searchText.toLowerCase())
          );
          const paginated = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
          return (
            <>
              <List>
                {paginated.map((brand) => (
                  <React.Fragment key={brand.id}>
                    <ListItem>
                      <ListItemText
                        primary={
                          <Typography variant="body1" fontWeight="bold">
                            {brand.brand_name}
                          </Typography>
                        }
                        secondary={brand.description || 'No description'}
                      />
                      <ListItemSecondaryAction>
                        <IconButton edge="end" onClick={() => handleEditBrand(brand)}>
                          <EditIcon />
                        </IconButton>
                        <IconButton edge="end" onClick={() => handleDeleteBrand(brand)} color="error">
                          <DeleteIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                    <Divider />
                  </React.Fragment>
                ))}
                {filtered.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                    No brands found
                  </Typography>
                )}
              </List>
              <TablePagination
                component="div"
                count={filtered.length}
                page={page}
                onPageChange={(_, newPage) => setPage(newPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                rowsPerPageOptions={[5, 10, 25]}
              />
            </>
          );
        })()}
      </CardContent>

      {/* Add/Edit Brand Dialog */}
      <Dialog open={brandDialog} onClose={handleCloseBrandDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingBrand ? 'Edit Brand' : 'Add New Brand'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Brand Name"
                value={brandFormData.brand_name}
                onChange={(e) => setBrandFormData({ ...brandFormData, brand_name: e.target.value })}
                autoFocus
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                value={brandFormData.description}
                onChange={(e) => setBrandFormData({ ...brandFormData, description: e.target.value })}
                multiline
                rows={3}
                placeholder="Optional: Add a description for this brand"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseBrandDialog}>Cancel</Button>
          <Button
            onClick={handleSaveBrand}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog}
        onClose={() => setDeleteDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Confirm Delete Brand
        </DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the brand "{brandToDelete?.brand_name}"? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={confirmDeleteBrand}
            variant="contained"
            color="error"
            disabled={loading}
          >
            {loading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};

export default BrandManagementMenu;
