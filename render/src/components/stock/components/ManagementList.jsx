import React from 'react';
import {
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider,
  Paper,
  Typography,
  Box,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';

const ManagementList = ({ items, onEdit, onDelete, title }) => {
  if (!items || items.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={150}>
        <Typography variant="body1" color="text.secondary">
          No {title.toLowerCase()} found
        </Typography>
      </Box>
    );
  }

  return (
    <Paper>
      <Box p={2}>
        <Typography variant="h6" gutterBottom>
          {title}
        </Typography>
        <List>
          {items.map((item, index) => (
            <React.Fragment key={item.id}>
              <ListItem>
                <ListItemText
                  primary={item.name}
                  secondary={item.description}
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end" onClick={() => onEdit(item)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton edge="end" onClick={() => onDelete(item.id)}>
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
              {index < items.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </List>
      </Box>
    </Paper>
  );
};

export default ManagementList;
