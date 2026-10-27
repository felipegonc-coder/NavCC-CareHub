import type { TabsBlock } from '@carehub/learning';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@carehub/ui';
import { RichTextView, type ViewProps } from '../media';

/**
 * A tabs block, on the kit's tabs: the arrow keys (and Home and End) move between tabs, which open as they get
 * focus, and Tab goes on to the open panel.
 */
export function TabsView({ block, course, go }: ViewProps<TabsBlock>) {
  return (
    <Tabs defaultValue={block.tabs[0]?.id}>
      <TabsList className="overflow-x-auto">
        {block.tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {block.tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          <RichTextView value={tab.body} course={course} go={go} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
