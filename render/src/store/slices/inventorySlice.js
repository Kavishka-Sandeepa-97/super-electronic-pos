import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';

// Async thunks for inventory operations
export const fetchCategories = createAsyncThunk(
  'inventory/fetchCategories',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.enhanced.getCategories();
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const fetchItemVariants = createAsyncThunk(
  'inventory/fetchItemVariants',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.enhanced.getItemVariants();
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const fetchVariants = createAsyncThunk(
  'inventory/fetchVariants',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.variants.getAll();
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const searchItemVariants = createAsyncThunk(
  'inventory/searchItemVariants',
  async (query, { rejectWithValue }) => {
    try {
      const response = await api.itemVariants.search(query);
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const searchByBarcode = createAsyncThunk(
  'inventory/searchByBarcode',
  async (barcode, { rejectWithValue }) => {
    try {
      const response = await api.itemVariants.searchByBarcode(barcode);
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const fetchItemsByCategory = createAsyncThunk(
  'inventory/fetchItemsByCategory',
  async (categoryId, { rejectWithValue }) => {
    try {
      const response = await api.itemVariants.getByCategoryId(categoryId);
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const inventorySlice = createSlice({
  name: 'inventory',
  initialState: {
    categories: [],
    variants: [],
    itemVariants: [],
    filteredItems: [],
    selectedCategory: 'all',
    searchTerm: '',
    loading: false,
    error: null,
    barcodeResult: null,
  },
  reducers: {
    setSelectedCategory: (state, action) => {
      state.selectedCategory = action.payload;
      state.filteredItems = state.selectedCategory === 'all'
        ? state.itemVariants
        : state.itemVariants.filter(item =>
            (item.category_name || '').toLowerCase() === (state.selectedCategory || '').toLowerCase()
          );
    },
    setSearchTerm: (state, action) => {
      state.searchTerm = action.payload;
    },
    filterItems: (state) => {
      let filtered = state.itemVariants;

      // Filter by category
      if (state.selectedCategory !== 'all') {
        filtered = filtered.filter(item =>
          (item.category_name || '').toLowerCase() === (state.selectedCategory || '').toLowerCase()
        );
      }

      // Filter by search term (safe checks)
      if (state.searchTerm) {
        const searchLower = (state.searchTerm || '').toLowerCase();
        filtered = filtered.filter(item => {
          const name = (item.item_name || item.name || '').toString().toLowerCase();
          const variant = (item.variant_name || item.variant || '').toString().toLowerCase();
          const category = (item.category_name || '').toString().toLowerCase();
          const barcode = (item.barcode || '').toString().toLowerCase();
          return (
            name.includes(searchLower) ||
            variant.includes(searchLower) ||
            category.includes(searchLower) ||
            barcode.includes(searchLower)
          );
        });
      }

      state.filteredItems = filtered;
    },
    clearBarcodeResult: (state) => {
      state.barcodeResult = null;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch categories
      .addCase(fetchCategories.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.loading = false;
        state.categories = action.payload;
      })
      .addCase(fetchCategories.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch variants
      .addCase(fetchVariants.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchVariants.fulfilled, (state, action) => {
        state.loading = false;
        state.variants = action.payload;
      })
      .addCase(fetchVariants.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch item variants
      .addCase(fetchItemVariants.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchItemVariants.fulfilled, (state, action) => {
        state.loading = false;
        state.itemVariants = action.payload;
        state.filteredItems = action.payload;
      })
      .addCase(fetchItemVariants.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Search item variants
      .addCase(searchItemVariants.fulfilled, (state, action) => {
        state.filteredItems = action.payload;
      })
      // Search by barcode
      .addCase(searchByBarcode.pending, (state) => {
        state.loading = true;
      })
      .addCase(searchByBarcode.fulfilled, (state, action) => {
        state.loading = false;
        state.barcodeResult = action.payload;
      })
      .addCase(searchByBarcode.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.barcodeResult = null;
      });
  },
});

export const {
  setSelectedCategory,
  setSearchTerm,
  filterItems,
  clearBarcodeResult,
  clearError,
} = inventorySlice.actions;

export default inventorySlice.reducer;