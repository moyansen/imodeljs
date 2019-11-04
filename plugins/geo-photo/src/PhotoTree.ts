
/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { Logger, BentleyError, BentleyStatus, SortedArray } from "@bentley/bentleyjs-core";
import { I18N } from "@bentley/imodeljs-i18n";
import { Point3d, XYZProps } from "@bentley/geometry-core";
import { IModelApp, IModelConnection, GeoConverter, QuantityType } from "@bentley/imodeljs-frontend";
import { Cartographic, IModelCoordinatesResponseProps, GeoCoordStatus } from "@bentley/imodeljs-common";
import { JpegTagReader, ImageTags, ImageTagValue, ImageTagsMap } from "./JpegTagReader";

export const loggerCategory = "Plugins.GeoPhoto";

/* -------------------- Callback for photo tree traversal ---------------------- */
export type PhotoTraverseFunction = (photoFile: PhotoFile, photoFolder: PhotoFolder) => Promise<void>;
export type FolderTraverseFunction = (folder: PhotoFolder, parentFolder: PhotoFolder) => void;

/* -------------------- Interface implemented to access a particular photo storage mechanism --------------- */

/** this interface is provided to allow retrieval of the tree of photos from any storage mechanism. */
export interface PhotoTreeHandler {
  // create the root folder. Do not read contents yet.
  createRootFolder(): Promise<PhotoFolder>;

  // read the folder contents (subFolders and photos).
  readFolderContents(folder: PhotoFolder, subFolders: boolean): Promise<FolderEntry[]>;

  // reads the file contents for each photo file.
  getFileContents(file: PhotoFile, byteCount?: number): Promise<Uint8Array>;

  // gets the cartographic positions for each photo file.
  getCartographicPositions(folder: PhotoFolder, subFolders: boolean): Promise<void>;

  // gets the spatial positions for each photo file from the Cartographic positions.
  getSpatialPositions(folder: PhotoFolder, subFolders: boolean): Promise<void>;

  getIModel(): IModelConnection;
}

// ---------------------- Base Classes for GeoPhoto tree members ---------------------------
// Implementation specific subclasses of these base classes are created by each storage-specific TreeHandler

/** Abstract base class for PhotoFolder and PhotoEntry */
export abstract class FolderEntry {
  private _visible: boolean;
  constructor(protected _treeHandler: PhotoTreeHandler, protected _parent: PhotoFolder | undefined) {
    this._visible = true;
  }

  abstract get name(): string;

  abstract get createTime(): string;

  get rootFolder(): PhotoFolder {
    if (this._parent === undefined)
      return (this as unknown) as PhotoFolder;
    return this._parent.rootFolder;
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(value: boolean) {
    this._visible = value;
  }
}

/** Abstract base class for folders in the GeoPhotos tree. */
export abstract class PhotoFolder extends FolderEntry {
  private _entries: FolderEntry[] | undefined;
  private _sortedByXNoChildren: DistanceSorter | undefined;
  private _sortedByXWithChildren: DistanceSorter | undefined;
  private _sortedByYNoChildren: DistanceSorter | undefined;
  private _sortedByYWithChildren: DistanceSorter | undefined;

  constructor(treeHandler: PhotoTreeHandler, parent: PhotoFolder | undefined) {
    super(treeHandler, parent);
    this._entries = undefined;
  }

  /** uses treeHandler to read the contents of this Folder. */
  public async getFolderContents(subFolders: boolean): Promise<FolderEntry[]> {
    if (!this._entries)
      this._entries = await this._treeHandler.readFolderContents(this, subFolders);

    return this._entries;
  }

  public async getSortedByX(subFolders: boolean): Promise<DistanceSorter> {
    if (subFolders && this._sortedByXWithChildren)
      return this._sortedByXWithChildren;
    else if (this._sortedByXNoChildren)
      return this._sortedByXNoChildren;

    const sorter: DistanceSorter = new DistanceSorter(0);
    await this.traversePhotos(sorter.insert.bind(sorter), subFolders, true);
    if (subFolders)
      this._sortedByXWithChildren = sorter;
    else
      this._sortedByXNoChildren = sorter;
    return sorter;
  }

  public async getSortedByY(subFolders: boolean): Promise<DistanceSorter> {
    if (subFolders && this._sortedByYWithChildren)
      return this._sortedByYWithChildren;
    else if (this._sortedByYNoChildren)
      return this._sortedByYNoChildren;

    const sorter: DistanceSorter = new DistanceSorter(1);
    await this.traversePhotos(sorter.insert.bind(sorter), subFolders, true);
    if (subFolders)
      this._sortedByYWithChildren = sorter;
    else
      this._sortedByYNoChildren = sorter;

    return sorter;
  }

  /** traverse each photo in this folder, calling func. Recurses into subFolders if desired. */
  public async traversePhotos(func: PhotoTraverseFunction, subFolders: boolean, visibleOnly: boolean) {
    if (!this._entries)
      return;

    for (const thisEntry of this._entries) {
      if (thisEntry instanceof PhotoFile) {
        if (!visibleOnly || thisEntry.visible) {
          await func(thisEntry, this);
        }
      }
    }

    if (!subFolders)
      return;

    for (const thisEntry of this._entries) {
      if (thisEntry instanceof PhotoFolder) {
        if (!visibleOnly || thisEntry.visible) {
          await thisEntry.traversePhotos(func, true, visibleOnly);
        }
      }
    }
  }

  public get photoCount(): number {
    if (!this._entries)
      return 0;
    let count: number = 0;
    for (const entry of this._entries) {
      if (entry instanceof PhotoFile) {
        count++;
      }
    }
    return count;
  }

  /** traverse each photo in this folder, calling func. Recurses into subFolders if desired. */
  public traverseFolders(func: FolderTraverseFunction, subFolders: boolean, visibleOnly: boolean) {
    if (!this._entries)
      return;

    for (const thisEntry of this._entries) {
      if (thisEntry instanceof PhotoFolder) {
        if (!visibleOnly || thisEntry.visible) {
          func(thisEntry, this);
        }
      }
    }

    if (!subFolders)
      return;

    for (const thisEntry of this._entries) {
      if (thisEntry instanceof PhotoFolder) {
        if (!visibleOnly || thisEntry.visible) {
          thisEntry.traverseFolders(func, true, visibleOnly);
        }
      }
    }
  }

}

export class GeoPhotoThumbnail {
  constructor(public comp: number, public xRes: number, public yRes: number, public resUnit: number, public offset: number, public byteCount: number) {
  }
}
/**
 * Subset of Jpeg Tags that are of interest to the geo-photo plugin.
 */
export class GeoPhotoTags {
  constructor(public geoLocation: Cartographic, public track: number, public time: number, public probablyPano: boolean, public thumbnail?: GeoPhotoThumbnail) {
  }
}

/** Abstract base class for Files in the GeoPhotos tree. */
export abstract class PhotoFile extends FolderEntry {
  public geoLocation: Cartographic | undefined;
  public track: number | undefined;
  public spatial: Point3d | undefined;
  public probablyPano: boolean | undefined;
  public takenTime: number | undefined;
  public visited: boolean;

  constructor(treeHandler: PhotoTreeHandler, parent: PhotoFolder, protected _i18n: I18N, geoLocation?: Cartographic, track?: number, spatial?: Point3d, probablyPano?: boolean, takenTime?: number) {
    super(treeHandler, parent);
    this.geoLocation = geoLocation;
    this.spatial = spatial;
    this.track = track;
    this.probablyPano = probablyPano;
    this.visited = false;
    this.takenTime = takenTime;
  }

  /** Gets the contents of the file. */
  public abstract getFileContents(byteCount?: number): Promise<Uint8Array>;

  /** Gets an Url that corresponds to the photo file. */
  public abstract get accessUrl(): string;

  public get isPanorama(): boolean {
    return this.probablyPano ? this.probablyPano : false;
  }

  public async getClosestNeighbors(allFolders: boolean, maxDistance?: number): Promise<PhotoFile[]> {
    if (undefined === maxDistance)
      maxDistance = 100.0; // meters
    const parentFolder: PhotoFolder = allFolders ? this.rootFolder : this._parent!;
    const xSorted: DistanceSorter = await parentFolder.getSortedByX(allFolders);
    const ySorted: DistanceSorter = await parentFolder.getSortedByY(allFolders);
    const xList: PhotoFile[] = xSorted.findClosePhotos(this, maxDistance);
    const yList: PhotoFile[] = ySorted.findClosePhotos(this, maxDistance);

    // we need the intersection of these two lists and accept the ones that are close enough.
    const distanceFilter: DistanceFilter = new DistanceFilter(yList, this.spatial!, maxDistance);
    const closeList: PhotoFile[] = xList.filter(distanceFilter.filter.bind(distanceFilter));
    closeList.sort(distanceFilter.sortFunc.bind(distanceFilter));
    return Promise.resolve(closeList);
  }

  public async getToolTip(): Promise<string | HTMLElement | undefined> {
    const toolTip = document.createElement("span");
    let toolTipHtml = this._i18n.translate(this.isPanorama ? "geoPhoto:messages.PanoramaFile" : "geoPhoto:messages.PhotoFile", { fileName: this.name });
    if (this.takenTime) {
      const dateString: string = new Date(this.takenTime).toLocaleString();
      toolTipHtml += this._i18n.translate("geoPhoto:messages.TakenTime", { date: dateString });
    } else {
      toolTipHtml += "<br>";
    }

    const coordFormatterSpec = await IModelApp.quantityFormatter.getFormatterSpecByQuantityType(QuantityType.Coordinate);
    const latLongFormatterSpec = await IModelApp.quantityFormatter.getFormatterSpecByQuantityType(QuantityType.LatLong);
    if (undefined !== latLongFormatterSpec && undefined !== coordFormatterSpec && undefined !== this.geoLocation) {
      try {
        const globalOrigin = this._treeHandler.getIModel().globalOrigin;
        const zAdjusted = this.geoLocation.height - globalOrigin.z;
        const cartographic = Cartographic.fromDegrees(this.geoLocation.longitude, this.geoLocation.latitude, this.geoLocation.height);
        const formattedLat = IModelApp.quantityFormatter.formatQuantity(Math.abs(cartographic.latitude), latLongFormatterSpec);
        const formattedLong = IModelApp.quantityFormatter.formatQuantity(Math.abs(cartographic.longitude), latLongFormatterSpec);
        const formattedHeight = IModelApp.quantityFormatter.formatQuantity(zAdjusted, coordFormatterSpec);
        const latDir = cartographic.latitude < 0 ? "S" : "N";
        const longDir = cartographic.longitude < 0 ? "W" : "E";
        toolTipHtml += this._i18n.translate("geoPhoto:messages.ToolTipGeo", { formattedLat, latDir, formattedLong, longDir, formattedHeight });
        if (this.spatial) {
          const xAdjusted = this.spatial.x - globalOrigin.x;
          const yAdjusted = this.spatial.y - globalOrigin.y;
          const formattedX = IModelApp.quantityFormatter.formatQuantity(xAdjusted, coordFormatterSpec);
          const formattedY = IModelApp.quantityFormatter.formatQuantity(yAdjusted, coordFormatterSpec);
          toolTipHtml += this._i18n.translate("geoPhoto:messages.ToolTipXY", { formattedX, formattedY, formattedHeight });
        }
      } catch { }
    }
    toolTip.innerHTML = toolTipHtml;
    return toolTip;
  }

  /** Utility function to get decimal degrees from the degree / minute / second array stored in a JPEG file */
  private static getDegreeMinSec(tagSet: ImageTags, baseName: string, positiveVal: string): number | undefined {
    const dmsArray = tagSet.get(baseName);
    if (!Array.isArray(dmsArray) || dmsArray.length < 3)
      return undefined;
    const ref: ImageTagValue = tagSet.get(baseName + "Ref");
    if (undefined === ref)
      return undefined;
    if (typeof ref !== "string")
      return undefined;
    const sign: number = (ref === positiveVal) ? 1.0 : -1.0;
    return sign * (dmsArray[0] + dmsArray[1] / 60.0 + dmsArray[2] / (3600.0));
  }

  /** There is no obvious way to tell whether a JPEG file contains a panorama or not. This function uses the heuristic that
   *  panorama files have an aspect ratio of 2:1.
   */
  private static getProbablyPano(tagSet: ImageTags): boolean {
    const pixelX = tagSet.get("PixelXDimension");
    const pixelY = tagSet.get("PixelYDimension");
    // err on the side of calling it a pano.
    if ((undefined === pixelX) || (undefined === pixelY)) {
      return true;
    }
    if ((typeof pixelX !== "number") || (typeof pixelY !== "number"))
      return true;

    return pixelX === 2 * pixelY;
  }

  private static getElevation(tagSet: ImageTags): number {
    const gpsElevation = tagSet.get("GPSAltitude");
    if ((undefined === gpsElevation) || (typeof gpsElevation !== "number"))
      return 0;
    return gpsElevation;
  }

  private static getTrack(tagSet: ImageTags): number {
    const gpsTrack = tagSet.get("GPSTrack");
    if ((undefined === gpsTrack) || (typeof gpsTrack !== "number"))
      return 0;
    return gpsTrack;
  }

  private static getTime(tagSet: ImageTags): number {
    const gpsTime = tagSet.get("GPSDateStamp");
    if ((undefined === gpsTime) || (typeof gpsTime !== "string"))
      return 0;
    const parsedTime = Date.parse(gpsTime);
    return (Number.isNaN(parsedTime)) ? 0 : parsedTime;
  }

  private static getThumbnailInfo(tagSet: ImageTags): GeoPhotoThumbnail | undefined {
    const thumbnail = tagSet.get("thumbnail");
    if (undefined === thumbnail || typeof thumbnail !== "object")
      return undefined;

    const tnMap = thumbnail as ImageTagsMap;
    const comp = tnMap.get("Compression");
    if (undefined === comp || typeof comp !== "number")
      return undefined;
    const xRes = tnMap.get("XResolution");
    if (undefined === xRes || typeof xRes !== "number")
      return undefined;
    const yRes = tnMap.get("YResolution");
    if (undefined === yRes || typeof yRes !== "number")
      return undefined;
    const resUnit = tnMap.get("ResolutionUnit");
    if (undefined === resUnit || typeof resUnit !== "number")
      return undefined;
    const offset = tnMap.get("JpegIFOffset");
    if (undefined === offset || typeof offset !== "number")
      return undefined;
    const byteCount = tnMap.get("JpegIFByteCount");
    if (undefined === byteCount || typeof byteCount !== "number")
      return undefined;

    return new GeoPhotoThumbnail(comp, xRes, yRes, resUnit, offset, byteCount);
  }

  /** Read tags from a JPEG image */
  public async readTagsFromJpeg(): Promise<GeoPhotoTags> {
    const byteCount = 60000; // 60 KB should be sufficient to read the GPS headers and Thumbnails
    const byteArray: Uint8Array = await this.getFileContents(byteCount);

    const tagSet: ImageTags = JpegTagReader.readTags(byteArray.buffer);

    const longitude = PhotoFile.getDegreeMinSec(tagSet, "GPSLongitude", "E");
    const latitude = PhotoFile.getDegreeMinSec(tagSet, "GPSLatitude", "N");
    const elevation = PhotoFile.getElevation(tagSet);
    const track = PhotoFile.getTrack(tagSet);
    const time = PhotoFile.getTime(tagSet);
    const probablyPano = PhotoFile.getProbablyPano(tagSet);
    const thumbnail = PhotoFile.getThumbnailInfo(tagSet);
    if (longitude === undefined || latitude === undefined)
      throw new BentleyError(BentleyStatus.ERROR, "There is no geographic tag in the jpeg file", Logger.logError, loggerCategory, () => ({ ...this }));

    const cartographic = new Cartographic(longitude, latitude, elevation);

    const tags = new GeoPhotoTags(cartographic, track, time, probablyPano, thumbnail);
    return tags;
  }
}

export class BasePhotoTreeHandler {
  constructor(protected _iModel: IModelConnection) {
  }

  public getIModel(): IModelConnection {
    return this._iModel;
  }

  /** Traverses the files to get their Spatial positions. This is set up as a separate pass to facility
   *  future optimization. Currently, it just does the files one by one. Batching up the lat/long
   *  values to calculate their spatial coordinates would improve efficiency.
   */
  public async getSpatialPositions(folder: PhotoFolder, subFolders: boolean): Promise<void> {
    const spatialPositionCollector = new SpatialPositionCollector(folder, subFolders, this._iModel);
    await spatialPositionCollector.getPositions();
  }
}

// this collects the spatial position of every photo.
class SpatialPositionCollector {
  private _haveGCS: boolean | undefined;
  private _gcsConverter: GeoConverter | undefined;
  private _geoPoints: XYZProps[] | undefined;
  private _photoFiles: PhotoFile[] | undefined;

  constructor(private _folder: PhotoFolder, private _subFolders: boolean, private _iModel: IModelConnection) {
  }

  private async getGcsConverterAvailable(iModel: IModelConnection) {
    // Determine if we have a usable GCS.
    const converter = iModel.geoServices.getConverter("WGS84");
    if (undefined === converter)
      return false;
    const requestProps: XYZProps[] = [{ x: 0, y: 0, z: 0 }];
    let haveConverter;
    try {
      const responseProps = await converter.getIModelCoordinatesFromGeoCoordinates(requestProps);
      haveConverter = responseProps.iModelCoords.length === 1 && responseProps.iModelCoords[0].s !== GeoCoordStatus.NoGCSDefined;
    } catch (_) {
      haveConverter = false;
    }
    if (haveConverter)
      this._gcsConverter = converter;
    return haveConverter;
  }

  private async gatherRequests(file: PhotoFile, _folder: PhotoFolder) {
    const geoLocation: Cartographic | undefined = file.geoLocation;
    if (geoLocation) {
      this._geoPoints!.push(new Point3d(geoLocation.longitude, geoLocation.latitude, geoLocation.height));
      this._photoFiles!.push(file);
    }
  }

  private async getEcefResults(file: PhotoFile, _folder: PhotoFolder) {
    const geoLocation: Cartographic | undefined = file.geoLocation;
    if (geoLocation) {
      const cartographic = Cartographic.fromDegrees(geoLocation.longitude, geoLocation.latitude, geoLocation.height);
      file.spatial = this._iModel.cartographicToSpatialFromEcef(cartographic);
    }
  }

  public async getPositions(): Promise<void> {
    if (undefined === this._haveGCS) {
      this._haveGCS = await this.getGcsConverterAvailable(this._iModel);
    }

    if (this._haveGCS) {
      // traverse all folders gathering up the required conversions.
      this._gcsConverter = this._iModel.geoServices.getConverter("WGS84");
      this._geoPoints = [];
      this._photoFiles = [];
      await this._folder.traversePhotos(this.gatherRequests.bind(this), this._subFolders, false);

      // make a single request to the server (it is broken up by the GeoServices layer)
      const response: IModelCoordinatesResponseProps = await this._gcsConverter!.getIModelCoordinatesFromGeoCoordinates(this._geoPoints);

      // put the answers in the photo file objects.
      for (let iPoint = 0; iPoint < response.iModelCoords.length; ++iPoint) {
        const status = response.iModelCoords[iPoint].s;
        if ((status === GeoCoordStatus.Success) || (status === GeoCoordStatus.OutOfUsefulRange)) {
          this._photoFiles![iPoint].spatial = Point3d.fromJSON(response.iModelCoords[iPoint].p);
        }
      }
    } else {
      // no gcs, just use ecef for each position.
      await this._folder.traversePhotos(this.getEcefResults.bind(this), this._subFolders, false);
    }
  }
}

class DistanceSorter {
  public sortedArray: SortedArray<PhotoFile>;

  constructor(private _axis: number) {
    const sortFunc = this._axis ? this.sortOnX : this.sortOnY;
    this.sortedArray = new SortedArray<PhotoFile>(sortFunc, true);
  }

  private sortOnX(lhs: PhotoFile, rhs: PhotoFile): number {
    return lhs.spatial!.x - rhs.spatial!.x;
  }
  private sortOnY(lhs: PhotoFile, rhs: PhotoFile): number {
    return lhs.spatial!.y - rhs.spatial!.y;
  }

  public findClosePhotos(photoFile: PhotoFile, maxDistance: number): PhotoFile[] {
    const thisIndex: number = this.sortedArray.indexOf(photoFile);
    if (thisIndex < 0)
      return [];

    // go towards the lower ones until out of range.
    const selector: string = (this._axis === 0) ? "x" : "y";
    const photoVal: number = (photoFile.spatial as any)[selector];
    let lowIndex: number = thisIndex - 1;
    for (; lowIndex > 0; --lowIndex) {
      const thisVal = (this.sortedArray.get(lowIndex)!.spatial as any)[selector];
      if ((photoVal - thisVal) > maxDistance)
        break;
    }
    // lowIndex points to the first before the acceptable range, so increment it.
    lowIndex++;

    const maxIndex = this.sortedArray.length;
    let highIndex = thisIndex + 1;
    for (; highIndex < maxIndex; ++highIndex) {
      const thisVal = (this.sortedArray.get(lowIndex)!.spatial as any)[selector];
      if ((thisVal - photoVal) > maxDistance)
        break;
    }

    // highIndex points to the first beyond the acceptable range, so decrement it.
    if (highIndex <= lowIndex)
      return [];

    // this is not good practice, but SortedArray has no slice.
    return (this.sortedArray as any)._array.slice(lowIndex, highIndex);
  }

  public async insert(photoFile: PhotoFile): Promise<void> {
    this.sortedArray.insert(photoFile);
    return Promise.resolve();
  }
}

class DistanceFilter {
  private _md2: number;

  constructor(private _yList: PhotoFile[], private _thisPosition: Point3d, maxDistance: number) {
    this._md2 = maxDistance * maxDistance;
  }

  private disSquared(file: PhotoFile) {
    const xDist = this._thisPosition.x - file.spatial!.x;
    const yDist = this._thisPosition.y - file.spatial!.y;
    return xDist * xDist + yDist * yDist;
  }

  public filter(member: PhotoFile): boolean {
    if (this._yList.indexOf(member) < 0) {
      return false;
    }
    const xDist = this._thisPosition.x - member.spatial!.x;
    const yDist = this._thisPosition.y - member.spatial!.y;
    const d2 = xDist * xDist + yDist * yDist;
    // filter out the ones too close (probably it's the one we started with) and those too far.
    return (d2 > 0.000001) && d2 < this._md2;
  }

  public sortFunc(lhs: PhotoFile, rhs: PhotoFile) {
    const lhsDistance = this.disSquared(lhs);
    const rhsDistance = this.disSquared(rhs);
    return lhsDistance - rhsDistance;
  }
}