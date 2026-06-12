import { Navigate } from 'react-router'
import { Layout } from '../components/layouts/Layout'
import { Camera, Home, Telemetry } from '../components/pages'
import { SettingsPage } from '../components/pages/settings/SettingsPage'
import { settingsRoutes } from './schemas/schema'
import { RoutePath } from './types'

export const appRoutes = [
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        path: `/${RoutePath.Home}`,
        element: <Home />
      },
      {
        path: `/${RoutePath.Telemetry}`,
        element: <Telemetry />
      },
      {
        path: `/${RoutePath.Cluster}`,
        element: <></>
      },
      {
        path: `/${RoutePath.Media}`,
        element: <Navigate to={`/${RoutePath.Settings}`} replace />
      },
      {
        path: `/${RoutePath.Camera}`,
        element: <Camera />
      },
      {
        path: `/${RoutePath.Settings}/*`,
        element: <SettingsPage />,
        children: settingsRoutes?.children ?? []
      }
    ]
  }
]
