import { useState } from 'react'
import './App.css'
import {Button, FluentProvider, webLightTheme} from '@fluentui/react-components'

function App() {
  const [count, setCount] = useState(0)
  return (
      <FluentProvider className={"layout"} theme={webLightTheme}>
          <Button onClick={() => setCount(count + 1)}>
              Increment {count}
          </Button>
      </FluentProvider>
  )
}

export default App