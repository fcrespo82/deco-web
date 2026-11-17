import unittest
from unittest.mock import patch
from bs4 import BeautifulSoup
from scraper import HCSwitchScraper
from worker import run


class CollectorTests(unittest.TestCase):
    def test_mac_table_header_order(self):
        scraper = HCSwitchScraper({"name": "Teste", "ip": "127.0.0.1"})
        soup = BeautifulSoup('<table><tr><th>VLAN ID</th><th>Port</th><th>MAC Address</th><th>Type</th></tr><tr><td>10</td><td>3</td><td>aa:bb:cc:dd:ee:ff</td><td>dynamic</td></tr></table>', 'html.parser')
        self.assertEqual(scraper._parse_mac_table_rows(soup), [{"mac": "AA:BB:CC:DD:EE:FF", "port": "3", "vlan": "10", "type": "dynamic"}])

    def test_worker_read_allowlist_and_fallback_rejection(self):
        request = {"config": {"name": "Teste", "ip": "127.0.0.1", "model": "builtin"}, "action": "reboot"}
        with self.assertRaises(ValueError):
            run(request)
        request["action"] = "collect"
        with patch.object(HCSwitchScraper, "scrape", return_value={"mac": "", "ports": []}):
            with self.assertRaises(ValueError):
                run(request)

    def test_mac_failure_does_not_discard_port_reading(self):
        request = {"config": {"name": "Teste", "ip": "127.0.0.1", "model": "builtin"}}
        with patch.object(HCSwitchScraper, "scrape", return_value={"mac": "AA:BB:CC:DD:EE:FF", "ports": [{"status": "up"}]}), patch.object(HCSwitchScraper, "scrape_mac_table", side_effect=ValueError("failed")):
            result = run(request)
        self.assertEqual(len(result["ports"]), 1)
        self.assertIsNotNone(result["mac_error"])


if __name__ == "__main__":
    unittest.main()

class StatisticsTests(unittest.TestCase):
    def test_good_packets_are_not_replaced_by_bad_packets(self):
        scraper = HCSwitchScraper({"name": "Teste", "ip": "127.0.0.1", "model": "KP-9000-9XHML-X"})
        port_html = '<table><tr><th>Port</th><th>State</th><th>Config</th><th>Actual</th><th>Flow</th><th>Flow Control</th></tr><tr><td>Port 1</td><td>Enable</td><td>Auto</td><td>1000M Full</td><td>off</td><td>off</td></tr><tr><td>Port 2</td><td>Enable</td><td>Auto</td><td>Link Down</td><td>off</td><td>off</td></tr></table>'
        stats_html = '<table><tr><th>Port</th><th>State</th><th>Link Status</th><th>TxGoodPkt</th><th>TxBadPkt</th><th>RxGoodPkt</th><th>RxBadPkt</th></tr><tr><td>Port 1</td><td>Enable</td><td>Link Up</td><td>0-1000</td><td>2</td><td>0-2000</td><td>3</td></tr></table>'
        def fetch(path):
            if path == '/port.cgi': return port_html
            if path == '/port.cgi?page=stats': return stats_html
            return '<html></html>'
        with patch.object(scraper, '_login'), patch.object(scraper, '_fetch', side_effect=fetch):
            result = scraper.scrape()
        self.assertEqual(result['ports'][0]['tx_bytes'], 800000)
        self.assertEqual(result['ports'][0]['rx_bytes'], 1600000)
        self.assertTrue(result['ports'][0]['counters_estimated'])
