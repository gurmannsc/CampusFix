import { CategoryType } from './enums.js';

export class Category {
  constructor({ categoryId, name, type, defaultPriority }) {
    this.categoryId = categoryId;
    this.name = name;
    this.type = type;
    this.defaultPriority = defaultPriority;
  }

  getDefaultPriority() {
    return this.defaultPriority;
  }

  // SERVICE complaints (Mess and Canteen) are routed to the Administrator, not to maintenance staff.
  get isService() {
    return this.type === CategoryType.SERVICE;
  }
}
