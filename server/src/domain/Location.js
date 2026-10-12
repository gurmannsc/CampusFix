export class Location {
  constructor({ locationId, block, floor, room, areaType }) {
    this.locationId = locationId;
    this.block = block;
    this.floor = floor;
    this.room = room;
    this.areaType = areaType;
  }
}
