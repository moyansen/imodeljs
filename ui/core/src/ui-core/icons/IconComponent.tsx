/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Icon */

import * as React from "react";
import { SvgSprite } from "./SvgSprite";

import "./IconComponent.scss";

/** Prototype for an IconSpec which can be a string or a ReactNode.
 * @public
 */
export type IconSpec = string | React.ReactNode;

/** Properties for the [[Icon]] React component
 * @public
 */
export interface IconProps {
  /** CSS class name or SvgSprite for icon */
  iconSpec?: IconSpec;
}

/** Icon Functional component
 * @public
 */
export const Icon: React.FunctionComponent<IconProps> = (props) => {  // tslint:disable-line:variable-name
  if (!props.iconSpec) return null;

  if (typeof props.iconSpec === "string") {
    // if string begins with "svg:" then we assume it was imported (into plugin source file) using webpack loader svg-sprite-loader
    if (props.iconSpec.startsWith("svg:") && props.iconSpec.length > 4)
      return (
        <i className="icon core-svg-icon">
          <SvgSprite src={props.iconSpec.slice(4)} />
        </i>
      );

    const className = "icon " + props.iconSpec;
    return (<i className={className} />);
  }
  return (
    <i className="icon core-svg-icon">
      {props.iconSpec}
    </i>
  );
};