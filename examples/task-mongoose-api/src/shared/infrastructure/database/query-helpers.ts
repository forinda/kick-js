/**
 * Convert ParsedQuery filters to a Mongoose filter object.
 * Maps KickJS filter operators to MongoDB query operators.
 */
export function buildMongoFilter(filters: Array<{ field: string; operator: string; value: string }>): Record<string, any> {
  const mongoFilter: Record<string, any> = {};

  for (const { field, operator, value } of filters) {
    switch (operator) {
      case 'eq':
        mongoFilter[field] = value;
        break;
      case 'neq':
        mongoFilter[field] = { $ne: value };
        break;
      case 'gt':
        mongoFilter[field] = { $gt: value };
        break;
      case 'gte':
        mongoFilter[field] = { $gte: value };
        break;
      case 'lt':
        mongoFilter[field] = { $lt: value };
        break;
      case 'lte':
        mongoFilter[field] = { $lte: value };
        break;
      case 'between': {
        const [min, max] = value.split(',');
        mongoFilter[field] = { $gte: min, $lte: max };
        break;
      }
      case 'in':
        mongoFilter[field] = { $in: value.split(',') };
        break;
      case 'contains':
        mongoFilter[field] = { $regex: value, $options: 'i' };
        break;
      case 'starts':
        mongoFilter[field] = { $regex: `^${value}`, $options: 'i' };
        break;
      case 'ends':
        mongoFilter[field] = { $regex: `${value}$`, $options: 'i' };
        break;
      default:
        mongoFilter[field] = value;
    }
  }

  return mongoFilter;
}

/**
 * Convert ParsedQuery sort to a Mongoose sort object.
 */
export function buildMongoSort(sort: Array<{ field: string; direction: 'asc' | 'desc' }>): Record<string, 1 | -1> {
  const mongoSort: Record<string, 1 | -1> = {};
  for (const { field, direction } of sort) {
    mongoSort[field] = direction === 'asc' ? 1 : -1;
  }
  if (Object.keys(mongoSort).length === 0) {
    mongoSort.createdAt = -1; // default sort
  }
  return mongoSort;
}

/**
 * Build a text search filter from the search string.
 */
export function buildMongoSearch(search: string): Record<string, any> {
  if (!search) return {};
  return { $text: { $search: search } };
}
