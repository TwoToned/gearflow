/**
 * Synchronous DOM patch that must run before React hydration.
 *
 * Patches Node.prototype.removeChild and Node.prototype.insertBefore
 * to gracefully handle cases where React tries to manipulate a DOM node
 * that has already been removed (by browser extensions, theme switching,
 * dynamic favicon, or hydration mismatches).
 *
 * This is a Server Component that injects an inline <script> so the patch
 * executes as part of the HTML — before any React code runs. The previous
 * "use client" + useEffect approach left a window during hydration where
 * the patch wasn't active, which is exactly when most crashes occur.
 */
export function DomPatch() {
  // Static string — no user input, no XSS risk.
  const patchScript = `(function(){
  if(Node.prototype.removeChild.__patched) return;
  var origRC = Node.prototype.removeChild;
  Node.prototype.removeChild = function(child){
    if(child && child.parentNode !== this) return child;
    return origRC.call(this, child);
  };
  Node.prototype.removeChild.__patched = true;

  var origIB = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function(newNode, refNode){
    if(refNode && refNode.parentNode !== this) return newNode;
    return origIB.call(this, newNode, refNode);
  };
})();`;

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: patchScript,
      }}
    />
  );
}
