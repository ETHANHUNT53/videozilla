import { createContext, useContext } from "react";
import { getStyle, type VideoStyle } from "./styles";

/** The active video style, so any component can read colours, fonts and layout without prop drilling. */
export const StyleContext = createContext<VideoStyle>(getStyle("midnight"));
export const useVideoStyle = () => useContext(StyleContext);
