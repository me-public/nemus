/**
 * Type declarations for ink v5 (ESM package used via dynamic import).
 * Provides basic types for the components and hooks we use.
 * Full types live in node_modules/ink/build/index.d.ts but can't be
 * resolved with moduleResolution: "node".
 */

declare module 'ink' {
  import { FC, ReactNode, Key as ReactKey } from 'react';

  // Render
  export interface Instance {
    rerender: (tree: ReactNode) => void;
    unmount: () => void;
    waitUntilExit: () => Promise<void>;
    cleanup: () => void;
    clear: () => void;
  }

  export interface RenderOptions {
    stdout?: NodeJS.WriteStream;
    stdin?: NodeJS.ReadStream;
    stderr?: NodeJS.WriteStream;
    debug?: boolean;
    exitOnCtrlC?: boolean;
    patchConsole?: boolean;
  }

  export function render(tree: ReactNode, options?: RenderOptions): Instance;

  // Components
  export interface BoxProps {
    children?: ReactNode;
    flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
    flexGrow?: number;
    flexShrink?: number;
    flexBasis?: number | string;
    alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
    alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch';
    justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly';
    width?: number | string;
    height?: number | string;
    minWidth?: number;
    minHeight?: number;
    padding?: number;
    paddingX?: number;
    paddingY?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    margin?: number;
    marginX?: number;
    marginY?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    gap?: number;
    columnGap?: number;
    rowGap?: number;
    borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'doubleSingle' | 'classic' | 'arrow';
    borderColor?: string;
    borderTop?: boolean;
    borderBottom?: boolean;
    borderLeft?: boolean;
    borderRight?: boolean;
    borderDimColor?: boolean;
    display?: 'flex' | 'none';
    overflow?: 'visible' | 'hidden';
  }

  export const Box: FC<BoxProps>;

  export interface TextProps {
    children?: ReactNode;
    color?: string;
    backgroundColor?: string;
    dimColor?: boolean;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    inverse?: boolean;
    wrap?: 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end';
  }

  export const Text: FC<TextProps>;

  export const Newline: FC<{ count?: number }>;
  export const Spacer: FC;

  export interface StaticProps<T> {
    items: T[];
    children: (item: T, index: number) => ReactNode;
    style?: BoxProps;
  }
  export function Static<T>(props: StaticProps<T>): ReactNode;

  export interface TransformProps {
    children?: ReactNode;
    transform: (children: string, index: number) => string;
  }
  export const Transform: FC<TransformProps>;

  // Hooks
  export interface Key {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageDown: boolean;
    pageUp: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    meta: boolean;
  }

  export function useInput(
    inputHandler: (input: string, key: Key) => void,
    options?: { isActive?: boolean }
  ): void;

  export function useApp(): { exit: (error?: Error) => void };
  export function useStdin(): { stdin: NodeJS.ReadStream; isRawModeSupported: boolean; setRawMode: (mode: boolean) => void };
  export function useStdout(): { stdout: NodeJS.WriteStream; write: (data: string) => void };
  export function useStderr(): { stderr: NodeJS.WriteStream; write: (data: string) => void };
  export function useFocus(options?: { autoFocus?: boolean; isActive?: boolean; id?: string }): { isFocused: boolean };
  export function useFocusManager(): { focusNext: () => void; focusPrevious: () => void; focus: (id: string) => void; enableFocus: () => void; disableFocus: () => void };
  export function measureElement(ref: { current: any }): { width: number; height: number };
}

declare module 'ink-select-input' {
  import { FC } from 'react';

  export interface Item<V> {
    key?: string;
    label: string;
    value: V;
  }

  export interface Props<V> {
    items?: Array<Item<V>>;
    isFocused?: boolean;
    initialIndex?: number;
    limit?: number;
    indicatorComponent?: FC<{ isSelected: boolean }>;
    itemComponent?: FC<{ isSelected: boolean; label: string }>;
    onSelect?: (item: Item<V>) => void;
    onHighlight?: (item: Item<V>) => void;
  }

  function SelectInput<V>(props: Props<V>): JSX.Element;
  export default SelectInput;
}

declare module 'ink-spinner' {
  import { FC } from 'react';

  export interface Props {
    type?: string;
  }

  const Spinner: FC<Props>;
  export default Spinner;
}
