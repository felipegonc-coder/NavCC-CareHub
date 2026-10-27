import { LoadFailed, ScreenLoading } from '../player/ScreenMessage';
import { Catalog } from './Catalog';
import { useCatalog } from './data';

/** `/learning/catalog`: the courses anyone in the workspace can take. */
export function CatalogScreen() {
  const catalog = useCatalog();
  if (!catalog.data) {
    if (!catalog.error) return <ScreenLoading label="Loading the catalog" />;
    return <LoadFailed error={catalog.error} what="page" retry={() => void catalog.refetch()} />;
  }
  return <Catalog entries={catalog.data} />;
}
