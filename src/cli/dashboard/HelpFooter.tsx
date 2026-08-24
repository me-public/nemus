import * as React from 'react';
import { InkComponents } from './types';

interface HelpFooterProps extends InkComponents {
  isZoomed: boolean;
}

export const HelpFooter: React.FC<HelpFooterProps> = ({ isZoomed, Box, Text }) => {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>───────────────────</Text>
      <Text><Text color="yellow">↑↓</Text> select  <Text color="yellow">f</Text>/⏎ focus</Text>
      <Text><Text color="yellow">z</Text>  {isZoomed ? 'unzoom' : 'zoom'}    <Text color="yellow">x</Text>   kill</Text>
      <Text><Text color="yellow">n</Text>  new     <Text color="yellow">q</Text>   detach</Text>
      <Text><Text color="yellow">s</Text>  resume  <Text color="yellow">Q</Text>   quit all</Text>
      <Text><Text color="yellow">r</Text>  reset layout</Text>
      <Text dimColor>───────────────────</Text>
      <Text dimColor>From agent pane:</Text>
      <Text> <Text color="yellow">prefix+M</Text> sidebar/reset</Text>
    </Box>
  );
};
