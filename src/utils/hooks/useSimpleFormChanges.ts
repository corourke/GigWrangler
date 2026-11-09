import { useState, useCallback, useEffect, useRef } from 'react';
import { UseFormReturn, FieldPath, FieldValues } from 'react-hook-form';

export interface UseSimpleFormChangesOptions<T extends FieldValues> {
  form?: UseFormReturn<T>; // Optional for manual state management
  initialData?: Partial<T>;
  currentData?: Partial<T>; // For nested data that's not in the form, or all data in manual mode
}

export interface SimpleFormChangeState<T extends FieldValues> {
  hasChanges: boolean;
  changedFields: Partial<T>;
  originalData: Partial<T>;
  isDirty: boolean;
}

/**
 * Simplified hook that tracks form changes using react-hook-form's built-in isDirty
 * and simple reference comparison for nested data, or manual state comparison.
 */
export function useSimpleFormChanges<T extends FieldValues>({
  form,
  initialData = {},
  currentData,
}: UseSimpleFormChangesOptions<T>) {
  const [originalData, setOriginalData] = useState<Partial<T>>(initialData);
  const [nestedDataChanged, setNestedDataChanged] = useState(false);

  // Track previous data for comparison
  const prevDataRef = useRef<Partial<T> | undefined>(undefined);

  /**
   * Check if data has changed using simple reference comparison
   */
  const hasDataChanged = useCallback(() => {
    if (!currentData) return false;

    if (form) {
      // React-hook-form mode: compare nested data only
      const formFieldNames = new Set(Object.keys(form.getValues()));
      const nestedData: Partial<T> = {};

      for (const key in currentData) {
        if (currentData.hasOwnProperty(key) && !formFieldNames.has(key)) {
          nestedData[key] = currentData[key];
        }
      }

      // Simple reference comparison for nested data
      const prevNestedData = prevDataRef.current;
      if (prevNestedData === undefined) {
        return false;
      }

      for (const key in nestedData) {
        if (nestedData[key] !== prevNestedData[key]) {
          return true;
        }
      }
      return false;
    } else {
      // Manual state management mode: compare all data
      const prevData = prevDataRef.current;
      if (prevData === undefined) return false;

      // Simple reference comparison for all fields
      for (const key in currentData) {
        if (currentData[key] !== prevData[key]) {
          return true;
        }
      }
      return false;
    }
  }, [currentData, form]);

  /**
   * Update data change state
   */
  const updateDataChanges = useCallback(() => {
    if (currentData) {
      const changed = hasDataChanged();
      setNestedDataChanged(changed);

      // Only update prevDataRef if this is the initial check (prevDataRef is undefined)
      // Otherwise, keep the original reference for comparison
      // prevDataRef should only be updated via loadInitialData or markAsSaved
      if (prevDataRef.current === undefined) {
        if (form) {
          // React-hook-form mode: store nested data only
          const formFieldNames = new Set(Object.keys(form.getValues()));
          const nestedData: Partial<T> = {};
          for (const key in currentData) {
            if (currentData.hasOwnProperty(key) && !formFieldNames.has(key)) {
              nestedData[key] = currentData[key];
            }
          }
          prevDataRef.current = nestedData;
        } else {
          // Manual mode: store all data
          prevDataRef.current = { ...currentData };
        }
      }
    }
  }, [currentData, hasDataChanged, form]);

  /**
   * Get changed fields
   * Uses react-hook-form's dirtyFields when form is provided, otherwise compares all data
   */
  const getChangedFields = useCallback((): Partial<T> => {
    if (form) {
      // React-hook-form mode: only form fields that are dirty
      const dirtyFields = form.formState.dirtyFields;
      const currentValues = form.getValues();
      const changes: Partial<T> = {};

      for (const key in dirtyFields) {
        if (dirtyFields.hasOwnProperty(key) && dirtyFields[key]) {
          changes[key] = currentValues[key];
        }
      }
      return changes;
    } else if (currentData) {
      // Manual mode: compare all current data with original
      const changes: Partial<T> = {};

      for (const key in currentData) {
        if (currentData.hasOwnProperty(key) && currentData[key] !== originalData[key]) {
          changes[key] = currentData[key];
        }
      }
      return changes;
    }
    return {};
  }, [form, currentData, originalData]);

  /**
   * Mark the form as saved - update original data and reset dirty state
   */
  const markAsSaved = useCallback((newData?: Partial<T>) => {
    if (form) {
      // React-hook-form mode
      const currentValues = form.getValues();
      const updatedOriginal = newData || currentValues;

      setOriginalData(updatedOriginal);
      setNestedDataChanged(false);

      // Get form field names BEFORE reset
      const formFieldNames = new Set(Object.keys(form.getValues()));
      
      // Extract form data and nested data
      const formData: Partial<T> = {};
      const nestedData: Partial<T> = {};
      
      for (const key in updatedOriginal) {
        if (updatedOriginal.hasOwnProperty(key)) {
          if (formFieldNames.has(key)) {
            formData[key] = updatedOriginal[key];
          } else {
            nestedData[key] = updatedOriginal[key];
          }
        }
      }

      // Reset form dirty state with only form fields
      form.reset(formData as T);

      // Update previous nested data reference with nested data from currentData if available
      // This ensures we track the latest nested data state
      if (currentData) {
        const currentNestedData: Partial<T> = {};
        for (const key in currentData) {
          if (currentData.hasOwnProperty(key) && !formFieldNames.has(key)) {
            currentNestedData[key] = currentData[key];
          }
        }
        prevDataRef.current = currentNestedData;
      } else {
        prevDataRef.current = nestedData;
      }
    } else if (currentData) {
      // Manual state management mode
      const updatedOriginal = newData || currentData;
      setOriginalData(updatedOriginal);
      setNestedDataChanged(false);
      prevDataRef.current = { ...updatedOriginal };
    }
  }, [form, currentData]);

  /**
   * Reset form to original data
   */
  const resetToOriginal = useCallback(() => {
    if (form) {
      form.reset(originalData as T);
    }
    setNestedDataChanged(false);
  }, [form, originalData]);

  /**
   * Load new initial data (e.g., when editing existing record)
   */
  const loadInitialData = useCallback((data: Partial<T>) => {
    setOriginalData(data);
    setNestedDataChanged(false);

    if (form) {
      // React-hook-form mode
      // Only reset form with fields that are actually in the form schema/defaultValues
      // First, get the current form field names BEFORE reset
      const formFieldNames = new Set(Object.keys(form.getValues()));
      
      // Extract form data (fields in form) and nested data (fields not in form)
      const formData: Partial<T> = {};
      const nestedData: Partial<T> = {};
      
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          if (formFieldNames.has(key)) {
            formData[key] = data[key];
          } else {
            nestedData[key] = data[key];
          }
        }
      }
      
      // Reset form with only form fields
      form.reset(formData as T);
      
      // Initialize previous nested data reference
      prevDataRef.current = nestedData;
    } else {
      // Manual mode: initialize previous data reference
      prevDataRef.current = { ...data };
    }
  }, [form]);

  /**
   * Check if a specific field has changes
   */
  const hasFieldChanged = useCallback((fieldName: FieldPath<T>) => {
    if (form) {
      const currentValues = form.getValues();
      return currentValues[fieldName] !== originalData[fieldName];
    } else if (currentData) {
      return currentData[fieldName] !== originalData[fieldName];
    }
    return false;
  }, [form, currentData, originalData]);

  // Update data changes when currentData changes
  useEffect(() => {
    updateDataChanges();
  }, [updateDataChanges]);

  // Calculate if there are any changes using react-hook-form's isDirty or nested data changes
  const hasAnyChanges = (() => {
    if (form) {
      return form.formState.isDirty || nestedDataChanged;
    }
    return nestedDataChanged;
  })();

  const changeState: SimpleFormChangeState<T> = {
    hasChanges: hasAnyChanges,
    changedFields: getChangedFields(),
    originalData,
    isDirty: form ? form.formState.isDirty : false,
  };

  return {
    // State
    ...changeState,

    // Actions
    markAsSaved,
    resetToOriginal,
    loadInitialData,
    getChangedFields,
    hasFieldChanged,

    // For backward compatibility (no-op since we use react-hook-form's dirty state)
    updateChangedFields: () => {},
  };
}