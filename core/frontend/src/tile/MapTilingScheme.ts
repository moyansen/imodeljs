/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @packageDocumentation
 * @module Tile
 */

import { assert } from "@bentley/bentleyjs-core";
import {
  Cartographic,
  EcefLocation,
} from "@bentley/imodeljs-common";
import {
  Angle,
  Point2d,
  Point3d,
  Range2d,
  Transform,
  Vector3d,
} from "@bentley/geometry-core";
import { IModelConnection } from "../IModelConnection";

/** @internal */
export class QuadId {
  public level: number;
  public column: number;
  public row: number;
  public get isValid() { return this.level >= 0; }
  private static _scratchCartographic = new Cartographic();
  public static createFromContentId(stringId: string) {
    const idParts = stringId.split("_");
    if (3 !== idParts.length) {
      assert(false, "Invalid quad tree ID");
      return new QuadId(-1, -1, -1);
    }
    return new QuadId(parseInt(idParts[0], 10), parseInt(idParts[1], 10), parseInt(idParts[2], 10));
  }
  public get contentId(): string { return this.level + "_" + this.column + "_" + this.row; }

  public constructor(level: number, column: number, row: number) {
    this.level = level;
    this.column = column;
    this.row = row;
  }
  // Not used in display - used only to tell whether this tile overlaps the range provided by a tile provider for attribution.
  public getLatLongRange(mapTilingScheme: MapTilingScheme): Range2d {
    const range = Range2d.createNull();
    mapTilingScheme.tileXYToCartographic(this.column, this.row, this.level, QuadId._scratchCartographic);
    range.extendXY(QuadId._scratchCartographic.longitude * Angle.degreesPerRadian, QuadId._scratchCartographic.latitude * Angle.degreesPerRadian);
    mapTilingScheme.tileXYToCartographic(this.column + 1, this.row + 1, this.level, QuadId._scratchCartographic);
    range.extendXY(QuadId._scratchCartographic.longitude * Angle.degreesPerRadian, QuadId._scratchCartographic.latitude * Angle.degreesPerRadian);

    return range;
  }
}

/** @internal */
export class MapTileRectangle extends Range2d {
  public constructor(west = 0, south = 0, east = 0, north = 0) {
    super(west, south, east, north);
  }
  public static create(west = 0, south = 0, east = 0, north = 0, result?: MapTileRectangle): MapTileRectangle {
    if (!result)
      return new MapTileRectangle(west, south, east, north);
    result.init(west, south, east, north);
    return result;
  }
  public get west() { return this.low.x; }
  public set west(x: number) { this.low.x = x; }
  public get south() { return this.low.y; }
  public set south(y: number) { this.low.y = y; }
  public get east() { return this.high.x; }
  public set east(x: number) { this.high.x = x; }
  public get north() { return this.high.y; }
  public set north(y: number) { this.high.y = y; }

  public init(west = 0, south = 0, east = 0, north = 0) {
    this.west = west;
    this.south = south;
    this.east = east;
    this.north = north;
  }
  public containsCartographic(carto: Cartographic) { return this.containsXY(carto.longitude, carto.latitude); }
  public getCenter(result?: Cartographic): Cartographic {
    return Cartographic.fromRadians((this.west + this.east) / 2, (this.north + this.south) / 2, 0, result);
  }
}

/** @internal */
export abstract class MapTilingScheme {
  private _scratchFraction = Point2d.createZero();

  /**
   * @param longitude in radians (-pi to pi)
   */
  public longitudeToXFraction(longitude: number) {
    return longitude / Angle.pi2Radians + .5;
  }

  /**
   * Return longitude in radians (-pi to pi from fraction).
   * @param xFraction
   */
  public xFractionToLongitude(xFraction: number) {
    return Angle.pi2Radians * (xFraction - .5);
  }

  public abstract yFractionToLatitude(yFraction: number): number;
  public abstract latitudeToYFraction(latitude: number): number;

  protected constructor(public readonly numberOfLevelZeroTilesX: number, public readonly numberOfLevelZeroTilesY: number, private _rowZeroAtTop: boolean) { }
  /**
   * Gets the total number of tiles in the X direction at a specified level-of-detail.
   *
   * @param {Number} level The level-of-detail.  Level 0 is the root tile.
   * @returns {Number} The number of tiles in the X direction at the given level.
   */
  public getNumberOfXTilesAtLevel(level: number) {
    return 0 === level ? 1 : this.numberOfLevelZeroTilesX << (level - 1);
  }

  /**
   * Gets the total number of tiles in the Y direction at a specified level-of-detail.
   *
   *
   * @param {Number} level The level-of-detail.  Level 0 is the root tile.
   * @returns {Number} The number of tiles in the Y direction at the given level.
   */
  public getNumberOfYTilesAtLevel(level: number): number {
    return (0 === level) ? 1 : this.numberOfLevelZeroTilesY << (level - 1);
  }
  public tileXToFraction(x: number, level: number): number {
    return x / this.getNumberOfXTilesAtLevel(level);
  }

  public tileYToFraction(y: number, level: number): number {
    let yFraction = y / this.getNumberOfYTilesAtLevel(level);

    if (this._rowZeroAtTop)
      yFraction = 1.0 - yFraction;

    return yFraction;
  }

  public tileXToLongitude(x: number, level: number) {
    return this.xFractionToLongitude(this.tileXToFraction(x, level));
  }
  public tileYToLatitude(y: number, level: number) {
    return this.yFractionToLatitude(this.tileYToFraction(y, level));
  }

  /**
   * Gets the fraction of the normalized (0-1) coordinates with at left, bottom.
   *
   * @param x  column
   * @param y  row
   * @param level depth
   * @param result result (0-1 from left, bottom
   */
  public tileXYToFraction(x: number, y: number, level: number, result?: Point2d): Point2d {
    if (undefined === result)
      result = Point2d.createZero();

    result.x = this.tileXToFraction(x, level);
    result.y = this.tileYToFraction(y, level);

    return result;
  }
  /**
   *
   * @param x column
   * @param y row
   * @param level depth
   * @param result result longitude, latitude.
   * @param height height (optional)
   */
  public tileXYToCartographic(x: number, y: number, level: number, result: Cartographic, height?: number): Cartographic {
    this.tileXYToFraction(x, y, level, this._scratchFraction);
    return this.fractionToCartographic(this._scratchFraction.x, this._scratchFraction.y, result, height);
  }
  public tileXYToRectangle(x: number, y: number, level: number, result?: MapTileRectangle) {
    return MapTileRectangle.create(this.tileXToLongitude(x, level), this.tileYToLatitude(y, level), this.tileXToLongitude(x + 1, level), this.tileYToLatitude(y + 1, level), result);

  }
  /**
   *
   * @param xFraction
   * @param yFraction
   * @param result
   * @param height
   */
  public fractionToCartographic(xFraction: number, yFraction: number, result: Cartographic, height?: number): Cartographic {
    result.longitude = this.xFractionToLongitude(xFraction);
    result.latitude = this.yFractionToLatitude(yFraction);
    result.height = undefined === height ? 0.0 : height;
    return result;
  }
  public cartographicToFraction(latitudeRadians: number, longitudeRadians: number, result: Point2d): Point2d {
    result.x = this.longitudeToXFraction(longitudeRadians);
    result.y = this.latitudeToYFraction(latitudeRadians);
    return result;
  }
  // gets the longitude and latitude into a point with coordinates between 0 and 1
  public ecefToPixelFraction(point: Point3d): Point3d {
    const cartoGraphic = Cartographic.fromEcef(point)!;
    return Point3d.create(this.longitudeToXFraction(cartoGraphic.longitude), this.latitudeToYFraction(cartoGraphic.latitude), 0.0);
  }

  public computeMercatorFractionToDb(iModel: IModelConnection, groundBias: number): Transform {
    const ecefLocation: EcefLocation = iModel.ecefLocation!;
    const dbToEcef = ecefLocation.getTransform();

    const projectCenter = Point3d.create(iModel.projectExtents.center.x, iModel.projectExtents.center.y, groundBias);
    const projectEast = Point3d.create(projectCenter.x + 1.0, projectCenter.y, groundBias);
    const projectNorth = Point3d.create(projectCenter.x, projectCenter.y + 1.0, groundBias);

    const mercatorOrigin = this.ecefToPixelFraction(dbToEcef.multiplyPoint3d(projectCenter));
    const mercatorX = this.ecefToPixelFraction(dbToEcef.multiplyPoint3d(projectEast));
    const mercatorY = this.ecefToPixelFraction(dbToEcef.multiplyPoint3d(projectNorth));

    const deltaX = Vector3d.createStartEnd(mercatorOrigin, mercatorX);
    const deltaY = Vector3d.createStartEnd(mercatorOrigin, mercatorY);

    const dbToMercator = Transform.createOriginAndMatrixColumns(mercatorOrigin, deltaX, deltaY, Vector3d.create(0.0, 0.0, 1.0)).multiplyTransformTransform(Transform.createTranslationXYZ(-projectCenter.x, -projectCenter.y, -groundBias));
    return dbToMercator.inverse() as Transform;
  }
}

/** @internal */
export class GeographicTilingScheme extends MapTilingScheme {
  public constructor(numberOfLevelZeroTilesX: number = 2, numberOfLevelZeroTilesY: number = 1, rowZeroAtTop: boolean = false) {
    super(numberOfLevelZeroTilesX, numberOfLevelZeroTilesY, rowZeroAtTop);
  }
  public yFractionToLatitude(yFraction: number): number {
    return Math.PI * (yFraction - .5);
  }
  public latitudeToYFraction(latitude: number): number {
    return .5 + latitude / Math.PI;
  }
}

/** @internal */
export class WebMercatorTilingScheme extends MapTilingScheme {
  public constructor(numberOfLevelZeroTilesX: number = 2, numberOfLevelZeroTilesY: number = 2, rowZeroAtTop: boolean = false) {
    super(numberOfLevelZeroTilesX, numberOfLevelZeroTilesY, rowZeroAtTop);
  }
  public yFractionToLatitude(yFraction: number): number {
    const mercatorAngle = Angle.pi2Radians * (yFraction - .5);
    return Angle.piOver2Radians - (2.0 * Math.atan(Math.exp(mercatorAngle)));
  }
  public latitudeToYFraction(latitude: number): number {
    const sinLatitude = Math.sin(latitude);
    return (0.5 - Math.log((1.0 + sinLatitude) / (1.0 - sinLatitude)) / (4.0 * Angle.piRadians));   // https://msdn.microsoft.com/en-us/library/bb259689.aspx
  }
}
