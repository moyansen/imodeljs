/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @packageDocumentation
 * @module PresentationRules
 */

import { RelationshipDirection } from "./RelationshipDirection";
import { SingleSchemaClassSpecification } from "./ClassSpecifications";
import { RelationshipPathSpecification } from "./RelationshipPathSpecification";

/**
 * This sub-specification allows joining the primary node instance with any number of related instances and creating
 * hierarchies based on a mix of those related instances.
 *
 * The related instance property values can be accessed from multiple different places:
 * - Instance filter
 * - Customization rule value
 * - Grouping rule
 *
 * **Example:**
 * ```JSON
 * {
 *   "id": "related_instance_example",
 *   "rules": [{
 *     "ruleType": "LabelOverride",
 *     "condition": "ThisNode.IsInstanceNode ANDALSO this.IsOfClass(\"Model\", \"BisCore\")",
 *     "label": "modeledElement.UserLabel"
 *   }, {
 *     "ruleType": "Grouping",
 *     "condition": "ParentNode.IsNull",
 *     "class": {
 *       "schemaName": "BisCore",
 *       "className": "Element"
 *     },
 *     "groups": [{
 *       "specType": "Property",
 *       "propertyName": "CodeValue",
 *       "createGroupForSingleItem": true
 *     }]
 *   }, {
 *     "ruleType": "RootNodes",
 *     "specifications": [{
 *       "specType": "InstanceNodesOfSpecificClasses",
 *       "classes": { "schemaName": "BisCore", "classNames": ["GeometricModel"] },
 *       "arePolymorphic": true,
 *       "instanceFilter": "modeledElement.CodeNamespace = 1",
 *       "relatedInstances": [{
 *         "relationshipPath": [{
 *           "relationship": { "schemaName": "BisCore", "className": "ModelModelsElement" },
 *           "direction": "Forward",
 *         }],
 *         "class": { "schemaName": "BisCore", "className": "Element" },
 *         "alias": "modeledElement"
 *       }]
 *     }]
 *   }]
 * }
 * ```
 * Here `BisCore:GeometricModel` instances are joined with `BisCore:Element` instances to create the hierarchy. This allows:
 * - Related `BisCore:Element` properties to be accessed in `InstanceFilter` using `modeledElement` alias.
 * - The `LabelOverride` rule to use `modeledElement` alias to access properties of the joined related instance.
 * - The `GroupingRule` to be applied because it's grouping `BisCore:Element` which is now part of the generated nodes.
 *
 * @public
 */
export type RelatedInstanceSpecification = DEPRECATED_RelatedInstanceSpecification | RelatedInstanceSpecificationNew;

/**
 * Deprecated [[RelatedInstanceSpecification]] specification.
 * @public
 * @deprecated Use `RelatedInstanceSpecificationNew`. Will be removed in iModel.js 3.0
 */
export interface DEPRECATED_RelatedInstanceSpecification { // tslint:disable-line: naming-convention class-name
  /** Specification of the relationship to use for joining the related instance */
  relationship: SingleSchemaClassSpecification;

  /** Specification of the related instance class. */
  class: SingleSchemaClassSpecification;

  /** Direction of the relationship */
  requiredDirection: RelationshipDirection.Forward | RelationshipDirection.Backward;

  /**
   * The alias to give for the joined related instance. Used to reference the related instance in
   * instance filter and customization rules.
   *
   * **The value must be unique per-specification!**
   *
   * @pattern ^\w[\w\d]*$
   */
  alias: string;

  /**
   * Is the related instance required to exist. If yes, primary instance won't be returned
   * if the related instance doesn't exist. If not, primary instance will be returned, but related
   * instance will be null.
   *
   * In SQL terms in can be compared to INNER JOIN vs OUTER JOIN.
   */
  isRequired?: boolean;
}

/**
 * Updated [[RelatedInstanceSpecification]] specification.
 * @beta
 */
export interface RelatedInstanceSpecificationNew {
  /**
   * Relationship path to find the related instance.
   */
  relationshipPath: RelationshipPathSpecification;

  /**
   * The alias to give for the joined related instance. Used to reference the related instance in
   * instance filter and customization rules.
   *
   * **The value must be unique per-specification!**
   *
   * @pattern ^\w[\w\d]*$
   */
  alias: string;

  /**
   * Is the related instance required to exist. If yes, primary instance won't be returned
   * if the related instance doesn't exist. If not, primary instance will be returned, but related
   * instance will be null.
   *
   * In SQL terms in can be compared to INNER JOIN vs OUTER JOIN.
   */
  isRequired?: boolean;
}
