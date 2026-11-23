# Đọc dữ liệu bao đựng thẻ ID trên Shopee

Repo gồm công cụ đọc dữ liệu theo từ khóa và [mẫu CSV 295 sản phẩm từ 150 shop](data/shopee-id-cards-expanded.csv). Mẫu có 39 sản phẩm đã đối chiếu được số bán lũy kế từ ShopeeAnalytics. Các dòng thiếu dữ liệu bán để trống.

Chạy các lệnh từ thư mục gốc của dự án. Cần Node.js 20 trở lên.

```sh
npm install --prefix shopee_reader
```

## Đọc tệp HTML có sẵn

Dùng tệp HTML của trang kết quả đã hiển thị sản phẩm mà bạn được phép sử dụng. Trong Chrome, bạn có thể lưu trang đang mở bằng `⌘S` trên macOS hoặc `Ctrl+S` trên Windows. Có thể đọc nhiều tệp trong một lần chạy. `--keyword` gán cùng một từ khóa cho các tệp trong lệnh đó và có thể bỏ qua.

```sh
node shopee_reader/read.cjs html ~/Downloads/ket-qua-shopee.html \
  --keyword 'bao đựng thẻ sinh viên' -o data/shopee-id-cards.csv
```

## Tìm trực tiếp theo từ khóa

Chế độ này cần Google Chrome và sự đồng ý trước bằng văn bản của Shopee theo mục 3.1. [Điều khoản dịch vụ Shopee](https://help.shopee.vn/portal/4/article/77243)

```sh
node shopee_reader/read.cjs crawl 'bao đựng thẻ sinh viên' 'bao đựng thẻ dây rút' \
  --limit 20 -o data/shopee-id-cards.csv
```

Nếu bỏ qua từ khóa, công cụ dùng sáu cụm từ cho ba nhóm sản phẩm gồm bao thẻ học sinh và sinh viên, bao thẻ nhân viên, và bao thẻ bán theo lô hoặc dành cho hội nghị. Mỗi từ khóa đọc trang kết quả đầu tiên và lấy tối đa 20 sản phẩm theo mặc định. Nếu gặp yêu cầu xác minh, lỗi truy cập hoặc bố cục không đọc được, công cụ dừng và xuất phần dữ liệu đã thu được nếu có.

## Đặt mục tiêu theo số sản phẩm

`--target 1000` dừng khi đủ 1.000 cặp mã shop và mã sản phẩm. Với `crawl`, `--pages` đặt số trang tối đa cho mỗi từ khóa. Với `html`, truyền tất cả các tệp vào một lệnh để gộp trùng xuyên suốt. Thêm `--require-sold` nếu chỉ muốn giữ sản phẩm có số đã bán. Nếu nguồn hết trước khi đủ mục tiêu, công cụ lưu số hàng đã đọc và báo số còn thiếu.

```sh
node shopee_reader/read.cjs html ./anh-chup-du-lieu/*.html \
  --target 1000 --limit 60 -o data/shopee-id-cards-new.csv
```

## Đọc kết quả

CSV dùng UTF-8 có BOM để mở trong Excel. Mỗi hàng là một cặp mã shop và mã sản phẩm, kèm tên, liên kết, khoảng giá hiển thị, lượt bán, điểm đánh giá, số lượt đánh giá, từ khóa, nguồn và thời điểm đọc. Các chỉ số vắng trên trang để trống. `sold_display` giữ nguyên dạng hiển thị như `1,2k+`. Giá là giá hiển thị cho sản phẩm hoặc cả gói.

`sold_qty` là giá trị số của chỉ số “Đã bán”. `sold_qty_kind` ghi `exact` khi nguồn công bố số đầy đủ, `approximate` khi nguồn rút gọn và `lower_bound` khi nguồn có dấu `+`. Ví dụ, `1,2k+` có giá trị 1.200 và loại `lower_bound`. Chỉ số này dùng để so sánh lượng bán giữa sản phẩm. Báo cáo số đơn hàng sử dụng mã đơn và là một nguồn dữ liệu riêng.

Trong `data/shopee-id-cards-expanded.csv`, `tracked` ghi số bán lũy kế do ShopeeAnalytics theo dõi, có thể thấp hơn số Shopee hiển thị. Dữ liệu bổ sung được khớp theo mã shop và mã sản phẩm. `sold_source` trỏ tới báo cáo và `sold_read_at` ghi thời điểm báo cáo được truy vấn. [Phạm vi dữ liệu ShopeeAnalytics](https://www.shopeeanalytics.com/vn/search/market?keywords=bao+%C4%91%E1%BB%B1ng+th%E1%BA%BB)

Bộ lọc tiêu đề mặc định loại một số ví, ốp điện thoại, hộp thẻ nhớ và bao photocard. Thêm `--all-products` để giữ các mục đó. Công cụ cần đọc được tên và giá để ghi một hàng. Khi chạy lại, dùng `-o` với tên khác nếu muốn giữ lại tệp của lần trước.
