// react-is CJS → ESM 命名导出桥接
// 注意：必须用真实路径避免 Vite alias 循环引用
import * as RI from '../../node_modules/react-is/index.js';

const _RI = (RI as any).default ?? RI;

export const {
  ForwardRef,
  isForwardRef,
  isMemo,
  typeOf,
  isElement,
  isValidElementType,
  isFragment,
  isPortal,
  isProfiler,
  isStrictMode,
  isSuspense,
  isConcurrentMode,
  isContextConsumer,
  isContextProvider,
  isLazy,
} = _RI;

export default _RI;
