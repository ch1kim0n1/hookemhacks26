class TenantStreamRouter:
    def __init__(self, tenant_slug: str):
        self._slug = tenant_slug

    def resolve(self, stream: str) -> str:
        if not self._slug or self._slug == "default":
            return stream
        return f"{self._slug}.{stream}"

    def resolve_group(self, group: str) -> str:
        if not self._slug or self._slug == "default":
            return group
        return f"{self._slug}-{group}"

    @property
    def slug(self) -> str:
        return self._slug
